import { createInterface } from "node:readline";
import type { Command } from "commander";
import { expandAlias, type KotaConfig, loadConfig } from "./config.js";
import { confirmAction } from "./confirm.js";
import { AgentSession, type LoopOptions, runAgentLoop } from "./loop.js";
import { type ConversationHistory, getHistory } from "./memory/history.js";
import { createModelClient } from "./model/provider-factory.js";
import { getScheduler, resetScheduler } from "./scheduler/scheduler.js";

/** Parse a CLI numeric option, exiting with a clear message on invalid input. */
export function parseIntOption(value: string, name: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`Error: --${name} must be a positive integer, got "${value}"`);
    process.exit(1);
  }
  return n;
}

/** Resolve an ID or prefix to a full conversation ID. Exits on failure. */
export function resolveConversationId(history: ConversationHistory, idOrPrefix: string): string {
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

/**
 * Interactive REPL with persistent conversation context.
 * A single AgentSession is shared across all inputs — the agent
 * remembers previous turns and maintains running cost totals.
 */
export async function interactiveMode(options: LoopOptions, config?: KotaConfig) {
  const session = new AgentSession(options);
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr, // Use stderr for prompts so stdout stays clean
    prompt: "kota> ",
  });

  const scheduler = getScheduler();
  const stopScheduler = scheduler.startTimer(30_000, (dueItems) => {
    for (const item of dueItems) {
      console.error(`\n[kota] ⏰ Reminder: ${item.description}`);
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

/** Register the `history` subcommand and its children onto `program`. */
export function registerHistoryCommands(program: Command) {
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
      const modelSpec = opts.model || config.model || "claude-sonnet-4-6";
      const resolved = createModelClient({
        model: modelSpec,
        provider: config.modelProvider?.type,
        baseUrl: config.modelProvider?.baseUrl,
        apiKey: config.modelProvider?.apiKey,
      });
      await interactiveMode({
        model: resolved.model,
        verbose: opts.verbose || config.verbose,
        config,
        resumeConversation: fullId,
        client: resolved.client,
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
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (opts) => {
      const history = getHistory();
      const list = history.list({ cwd: process.cwd(), limit: 1000 });

      if (list.length === 0) {
        console.log("No conversations to delete.");
        return;
      }

      if (!opts.yes) {
        const confirmed = await confirmAction(
          `This will permanently delete ${list.length} conversation(s). Continue?`,
        );
        if (!confirmed) {
          console.log("Cancelled.");
          return;
        }
      }

      let count = 0;
      for (const c of list) {
        if (history.remove(c.id)) count++;
      }
      console.log(`Deleted ${count} conversation(s).`);
    });
}

/** Register the `run` command's `--continue` logic — resolve conversation ID. */
export function resolveRunContinue(
  opts: { continue?: boolean | string },
): string | undefined {
  if (!opts.continue) return undefined;
  const history = getHistory();
  if (typeof opts.continue === "string") {
    return resolveConversationId(history, opts.continue);
  }
  const recent = history.getMostRecent(process.cwd());
  if (recent) return recent.id;
  console.error("No previous conversation found for this directory.");
  process.exit(1);
}

/** Execute the pipe-mode agent loop (shared between checkPipeMode paths). */
export async function runPipeLoop(piped: string): Promise<void> {
  const config = loadConfig();
  const resolved = createModelClient({
    model: config.model || "claude-sonnet-4-6",
    provider: config.modelProvider?.type,
    baseUrl: config.modelProvider?.baseUrl,
    apiKey: config.modelProvider?.apiKey,
  });
  await runAgentLoop(piped, {
    model: resolved.model,
    maxTokens: config.maxTokens || 8192,
    verbose: config.verbose,
    architectMode: config.architect,
    thinkingEnabled: config.thinking,
    thinkingBudget: config.thinking ? (config.thinkingBudget || 10000) : undefined,
    config,
    client: resolved.client,
  });
}
