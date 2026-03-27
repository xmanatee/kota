import { createInterface } from "node:readline";
import { expandAlias, type KotaConfig, loadConfig } from "./config.js";
import { AgentSession, type LoopOptions, runAgentLoop } from "./loop.js";
import { type ConversationHistory, getHistory } from "./memory/history.js";
import { createModelClient } from "./model/provider-factory.js";
import { getScheduler, resetScheduler } from "./scheduler/scheduler.js";

export { registerHistoryCommands } from "./cli-history-commands.js";

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
