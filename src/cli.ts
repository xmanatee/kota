import { createInterface } from "node:readline";
import { Command } from "commander";
import { ActionExecutor, partitionDueItems } from "./action-executor.js";
import { expandAlias, type KotaConfig, loadConfig } from "./config.js";
import { setSkipConfirmations } from "./confirm.js";
import { type ConversationHistory, getHistory } from "./history.js";
import { AgentSession, type LoopOptions, runAgentLoop } from "./loop.js";
import { installTool, listTools, removeTool, updateTool } from "./registry.js";
import { getScheduler, resetScheduler } from "./scheduler.js";
import { startServer } from "./server.js";
import { TelegramBot } from "./telegram.js";

/** Parse a CLI numeric option, exiting with a clear message on invalid input. */
export function parseIntOption(value: string, name: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`Error: --${name} must be a positive integer, got "${value}"`);
    process.exit(1);
  }
  return n;
}

/**
 * Check that the Anthropic API key is available before starting any agent.
 * Exits with a clear, actionable message if missing.
 */
function ensureApiKey(): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is not set.\n");
    console.error("To get started:");
    console.error("  1. Get your API key at https://console.anthropic.com/settings/keys");
    console.error("  2. Export it in your shell:\n");
    console.error("     export ANTHROPIC_API_KEY=sk-ant-...\n");
    process.exit(1);
  }
}

/** Check if an error is an Anthropic auth error and return a user-friendly message, or null. */
export function formatAuthError(err: Error): string | null {
  const msg = err.message || "";
  if (
    msg.includes("Could not resolve authentication") ||
    msg.includes("apiKey") ||
    msg.includes("authToken") ||
    (err as { status?: number }).status === 401
  ) {
    return [
      "Error: Anthropic API authentication failed.\n",
      "Check that your ANTHROPIC_API_KEY is set and valid:",
      "  export ANTHROPIC_API_KEY=sk-ant-...\n",
      "Get a key at https://console.anthropic.com/settings/keys",
    ].join("\n");
  }
  return null;
}

const program = new Command();

program
  .name("kota")
  .description("KOTA — Keep Only The Awesome. A general-purpose AI agent.")
  .version("0.1.0");

program
  .command("run", { isDefault: true })
  .description("Run KOTA with a prompt")
  .argument("[prompt...]", "The task to perform")
  .option("-m, --model <model>", "Model to use (default: claude-sonnet-4-6)")
  .option("--editor-model <model>", "Model for editor pass and sub-agents (defaults to --model)")
  .option("--max-tokens <n>", "Max tokens per response")
  .option("-v, --verbose", "Show debug output")
  .option("-a, --architect", "Enable Architect/Editor split (two-pass reasoning)")
  .option("-i, --interactive", "Interactive mode (REPL)")
  .option("-s, --session <path>", "Session file for persistence/resume")
  .option("-y, --yes", "Skip confirmation prompts for destructive commands")
  .option("-t, --think", "Enable extended thinking for deeper reasoning")
  .option("--think-budget <tokens>", "Thinking budget in tokens (default: 10000, min: 1024)")
  .option("-c, --continue [id]", "Continue most recent conversation (or specify conversation ID)")
  .option("--no-history", "Disable automatic conversation history")
  .action(async (promptWords: string[], opts) => {
    // Validate numeric options before anything else
    const parsedMaxTokens = opts.maxTokens ? parseIntOption(opts.maxTokens, "max-tokens") : undefined;
    const parsedThinkBudget = opts.thinkBudget ? parseIntOption(opts.thinkBudget, "think-budget") : undefined;

    ensureApiKey();
    const config = loadConfig();

    // CLI flags override config file values
    const model = opts.model || config.model || "claude-sonnet-4-6";
    const editorModel = opts.editorModel || config.editorModel;
    const maxTokens = parsedMaxTokens || config.maxTokens || 8192;
    const verbose = opts.verbose || config.verbose || false;
    const architect = opts.architect || config.architect || false;
    const thinkEnabled = opts.think || config.thinking || false;
    const thinkBudget = parsedThinkBudget
      ? Math.max(1024, parsedThinkBudget)
      : (config.thinkingBudget || 10000);
    const skipConfirm = opts.yes || config.skipConfirmations || false;

    if (skipConfirm) setSkipConfirmations(true);

    // Resolve --continue flag: true means "most recent", string means specific ID/prefix
    let resumeId: string | undefined;
    if (opts.continue) {
      const history = getHistory();
      if (typeof opts.continue === "string") {
        resumeId = resolveConversationId(history, opts.continue);
      } else {
        const recent = history.getMostRecent(process.cwd());
        if (recent) {
          resumeId = recent.id;
        } else {
          console.error("No previous conversation found for this directory.");
          process.exit(1);
        }
      }
    }

    const options: LoopOptions = {
      model,
      editorModel,
      maxTokens,
      verbose,
      architectMode: architect,
      sessionPath: opts.session,
      thinkingEnabled: thinkEnabled,
      thinkingBudget: thinkEnabled ? Math.max(1024, thinkBudget) : undefined,
      config,
      resumeConversation: resumeId,
      noHistory: opts.history === false,
    };

    let prompt = promptWords.join(" ");
    prompt = expandAlias(prompt, config.aliases);

    if (opts.interactive || !prompt) {
      await interactiveMode(options, config);
    } else {
      await runAgentLoop(prompt, options);
    }
  });

program
  .command("serve")
  .description("Start KOTA as an HTTP API server with SSE streaming")
  .option("-p, --port <port>", "Port to listen on", "3000")
  .option("-m, --model <model>", "Model to use")
  .option("-v, --verbose", "Show debug output")
  .action((opts) => {
    const port = parseIntOption(opts.port, "port");
    ensureApiKey();
    const config = loadConfig();
    startServer({
      port,
      model: opts.model || config.model,
      verbose: opts.verbose || config.verbose,
      config,
    });
  });

program
  .command("telegram")
  .description("Run KOTA as a Telegram bot")
  .option("-t, --token <token>", "Telegram bot token (or set TELEGRAM_BOT_TOKEN env var)")
  .option("-m, --model <model>", "Model to use")
  .option("-v, --verbose", "Show debug output")
  .option("--allowed-chats <ids>", "Comma-separated list of allowed chat IDs")
  .action(async (opts) => {
    ensureApiKey();
    const config = loadConfig();
    const token = opts.token || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error("Telegram bot token required. Use --token or set TELEGRAM_BOT_TOKEN env var.");
      process.exit(1);
    }

    const allowedChatIds = opts.allowedChats
      ? opts.allowedChats.split(",").map((id: string) => Number.parseInt(id.trim(), 10)).filter(Number.isFinite)
      : undefined;

    const bot = new TelegramBot({
      token,
      model: opts.model || config.model,
      verbose: opts.verbose || config.verbose,
      config,
      allowedChatIds,
    });

    process.on("SIGINT", () => {
      console.log("\n[kota-telegram] Shutting down...");
      bot.stop();
      process.exit(0);
    });

    await bot.start();
  });

// --- Tools subcommand ---

const toolsCmd = program.command("tools").description("Manage installed tool packages");

toolsCmd
  .command("install <source>")
  .description("Install a tool from npm, URL, or GitHub (e.g., kota-weather, https://...tool.mjs, user/repo)")
  .action(async (source: string) => {
    try {
      console.error(`[kota] Installing from ${source}...`);
      const result = await installTool(source);
      console.log(`Installed "${result.name}" (${result.source}) — ${result.files.length} file(s)`);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

toolsCmd
  .command("list")
  .description("List installed tools")
  .action(() => {
    const tools = listTools();
    if (tools.length === 0) {
      console.log("No tools installed. Use `kota tools install <source>` to add one.");
      return;
    }

    console.log(`${"Name".padEnd(20)} ${"Source".padEnd(8)} ${"Version".padEnd(12)} URI`);
    console.log("-".repeat(72));
    for (const t of tools) {
      console.log(`${t.name.padEnd(20)} ${t.source.padEnd(8)} ${t.version.padEnd(12)} ${t.uri}`);
    }
  });

toolsCmd
  .command("remove <name>")
  .description("Remove an installed tool")
  .action((name: string) => {
    if (removeTool(name)) {
      console.log(`Removed "${name}".`);
    } else {
      console.error(`Tool "${name}" is not installed.`);
      process.exit(1);
    }
  });

toolsCmd
  .command("update <name>")
  .description("Update an installed tool to the latest version")
  .action(async (name: string) => {
    try {
      console.error(`[kota] Updating "${name}"...`);
      const result = await updateTool(name);
      console.log(`Updated "${result.name}" (${result.source})`);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

/**
 * Interactive REPL with persistent conversation context.
 * A single AgentSession is shared across all inputs — the agent
 * remembers previous turns and maintains running cost totals.
 */
async function interactiveMode(options: LoopOptions, config?: KotaConfig) {
  const session = new AgentSession(options);
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr, // Use stderr for prompts so stdout stays clean
    prompt: "kota> ",
  });

  // Set up autonomous action execution for scheduled items
  const actionExecutor = new ActionExecutor({
    sessionOptions: {
      model: options.model,
      verbose: options.verbose,
      config,
    },
  });

  const scheduler = getScheduler();
  const stopScheduler = scheduler.startTimer(30_000, (dueItems) => {
    const { actions, notifications } = partitionDueItems(dueItems);

    for (const item of notifications) {
      console.error(`\n[kota] ⏰ Reminder: ${item.description}`);
    }

    for (const item of actions) {
      if (!actionExecutor.canExecute()) {
        console.error(`\n[kota] Skipped action "${item.description}" — too many running`);
        continue;
      }
      console.error(`\n[kota] Running autonomous action: "${item.description}"...`);
      actionExecutor.execute(item).then((result) => {
        if (result.error) {
          console.error(`[kota] Action "${item.description}" failed: ${result.error}`);
        } else {
          console.error(`[kota] Action "${item.description}" completed (${Math.round(result.durationMs / 1000)}s)`);
          if (result.result) {
            console.log(result.result);
          }
        }
      }).catch(() => {});
    }
  });

  console.error("KOTA — interactive mode. Type your task, or 'exit' to quit.\n");
  rl.prompt();

  rl.on("line", async (line) => {
    let input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }
    if (input === "exit" || input === "quit") {
      stopScheduler();
      resetScheduler();
      session.close();
      rl.close();
      return;
    }

    input = expandAlias(input, config?.aliases);

    try {
      await session.send(input);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
    }
    console.log(); // blank line between interactions
    rl.prompt();
  });

  rl.on("close", () => {
    stopScheduler();
    resetScheduler();
    session.close();
    console.error("\nGoodbye.");
    process.exit(0);
  });
}

/** Resolve an ID or prefix to a full conversation ID. Exits on failure. */
function resolveConversationId(history: ConversationHistory, idOrPrefix: string): string {
  try {
    const record = history.findByPrefix(idOrPrefix);
    if (!record) {
      console.error(`Conversation "${idOrPrefix}" not found.`);
      process.exit(1);
    }
    return record.id;
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

// --- History subcommand ---

const historyCmd = program.command("history").description("Manage conversation history");

historyCmd
  .command("list")
  .description("List recent conversations")
  .option("-n, --limit <n>", "Number of conversations to show", "10")
  .option("-s, --search <query>", "Filter by search term")
  .option("--all", "Show conversations from all directories")
  .action((opts) => {
    const history = getHistory();
    const list = history.list({
      limit: parseIntOption(opts.limit, "limit"),
      search: opts.search,
      cwd: opts.all ? undefined : process.cwd(),
    });

    if (list.length === 0) {
      console.log("No conversations found.");
      return;
    }

    console.log(`${"ID".padEnd(17)} ${"Updated".padEnd(22)} ${"Msgs".padEnd(6)} Title`);
    console.log("-".repeat(80));
    for (const c of list) {
      const updated = new Date(c.updatedAt).toLocaleString("en-US", {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      });
      console.log(`${c.id.padEnd(17)} ${updated.padEnd(22)} ${String(c.messageCount).padEnd(6)} ${c.title}`);
    }
  });

historyCmd
  .command("show <id>")
  .description("Show conversation details")
  .action((idOrPrefix) => {
    const history = getHistory();
    const fullId = resolveConversationId(history, idOrPrefix);
    const data = history.load(fullId);
    if (!data) {
      console.error(`Conversation "${idOrPrefix}" not found.`);
      process.exit(1);
    }

    console.log(`Title:    ${data.record.title}`);
    console.log(`Created:  ${new Date(data.record.createdAt).toLocaleString()}`);
    console.log(`Updated:  ${new Date(data.record.updatedAt).toLocaleString()}`);
    console.log(`Model:    ${data.record.model}`);
    console.log(`Messages: ${data.record.messageCount}`);
    console.log(`Dir:      ${data.record.cwd}`);
    console.log();

    for (const msg of data.messages) {
      if (msg.role === "user" && typeof msg.content === "string") {
        console.log(`[user] ${msg.content.slice(0, 200)}`);
      } else if (msg.role === "assistant" && typeof msg.content === "string") {
        console.log(`[assistant] ${msg.content.slice(0, 200)}`);
      } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
        const textBlock = msg.content.find((b) => "type" in b && b.type === "text");
        if (textBlock && "text" in textBlock) {
          console.log(`[assistant] ${String(textBlock.text).slice(0, 200)}`);
        }
      }
    }
  });

historyCmd
  .command("resume <id>")
  .description("Resume a previous conversation")
  .option("-m, --model <model>", "Model to use")
  .option("-v, --verbose", "Show debug output")
  .action(async (idOrPrefix, opts) => {
    const config = loadConfig();
    const history = getHistory();
    const fullId = resolveConversationId(history, idOrPrefix);
    const model = opts.model || config.model || "claude-sonnet-4-6";
    await interactiveMode({
      model,
      verbose: opts.verbose || config.verbose,
      config,
      resumeConversation: fullId,
    }, config);
  });

historyCmd
  .command("delete <id>")
  .description("Delete a conversation")
  .action((idOrPrefix) => {
    const history = getHistory();
    const fullId = resolveConversationId(history, idOrPrefix);
    if (history.remove(fullId)) {
      console.log(`Conversation ${fullId} deleted.`);
    } else {
      console.error(`Conversation "${idOrPrefix}" not found.`);
      process.exit(1);
    }
  });

historyCmd
  .command("clear")
  .description("Delete all conversations for the current directory")
  .action(() => {
    const history = getHistory();
    const list = history.list({ cwd: process.cwd(), limit: 1000 });
    let count = 0;
    for (const c of list) {
      if (history.remove(c.id)) count++;
    }
    console.log(`Deleted ${count} conversation(s).`);
  });

// Handle stdin pipe mode
async function checkPipeMode() {
  if (!process.stdin.isTTY && process.argv.length <= 2) {
    const chunks: string[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk.toString());
    }
    const piped = chunks.join("").trim();
    if (piped) {
      ensureApiKey();
      const config = loadConfig();
      await runAgentLoop(piped, {
        model: config.model || "claude-sonnet-4-6",
        maxTokens: config.maxTokens || 8192,
        verbose: config.verbose,
        architectMode: config.architect,
        thinkingEnabled: config.thinking,
        thinkingBudget: config.thinking ? (config.thinkingBudget || 10000) : undefined,
        config,
      });
      return true;
    }
  }
  return false;
}

async function main() {
  const wasPiped = await checkPipeMode();
  if (!wasPiped) {
    await program.parseAsync();
  }
}

main().catch((err) => {
  const authMsg = formatAuthError(err);
  if (authMsg) {
    console.error(authMsg);
  } else {
    console.error(`Fatal: ${err.message}`);
  }
  process.exit(1);
});
