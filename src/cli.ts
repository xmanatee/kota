import { Command } from "commander";
import { createInterface } from "node:readline";
import { runAgentLoop, AgentSession, type LoopOptions } from "./loop.js";
import { setSkipConfirmations } from "./confirm.js";
import { loadConfig, expandAlias, type KotaConfig } from "./config.js";
import { startServer } from "./server.js";
import { getScheduler } from "./scheduler.js";
import { ActionExecutor, partitionDueItems } from "./action-executor.js";

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
  .action(async (promptWords: string[], opts) => {
    const config = loadConfig();

    // CLI flags override config file values
    const model = opts.model || config.model || "claude-sonnet-4-6";
    const editorModel = opts.editorModel || config.editorModel;
    const maxTokens = opts.maxTokens ? Number.parseInt(opts.maxTokens, 10) : (config.maxTokens || 8192);
    const verbose = opts.verbose || config.verbose || false;
    const architect = opts.architect || config.architect || false;
    const thinkEnabled = opts.think || config.thinking || false;
    const thinkBudget = opts.thinkBudget
      ? Math.max(1024, Number.parseInt(opts.thinkBudget, 10))
      : (config.thinkingBudget || 10000);
    const skipConfirm = opts.yes || config.skipConfirmations || false;

    if (skipConfirm) setSkipConfirmations(true);

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
    const config = loadConfig();
    startServer({
      port: Number.parseInt(opts.port, 10),
      model: opts.model || config.model,
      verbose: opts.verbose || config.verbose,
      config,
    });
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
    if (!input || input === "exit" || input === "quit") {
      stopScheduler();
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
    session.close();
    console.error("\nGoodbye.");
    process.exit(0);
  });
}

// Handle stdin pipe mode
async function checkPipeMode() {
  if (!process.stdin.isTTY && process.argv.length <= 2) {
    const chunks: string[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk.toString());
    }
    const piped = chunks.join("").trim();
    if (piped) {
      await runAgentLoop(piped, {
        model: "claude-sonnet-4-6",
        maxTokens: 8192,
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
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
