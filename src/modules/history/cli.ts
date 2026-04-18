import { createInterface } from "node:readline";
import { expandAlias, type KotaConfig, loadConfig } from "#core/config/config.js";
import { getScheduler, resetScheduler } from "#core/daemon/scheduler.js";
import { AgentSession, type LoopOptions, runAgentLoop } from "#core/loop/loop.js";
import { type ConversationHistory, getHistory } from "#core/memory/history.js";
import { formatAuthError } from "#core/model/auth-error.js";
import { createModelClient } from "#core/model/model-client.js";

export { registerHistoryCommands } from "./cli-commands.js";

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

const REPL_COMMANDS: Record<string, string> = {
  "/help": "Show available commands",
  "/status": "Show session info (model, state, cost)",
  "/reset": "Clear conversation and start fresh",
  "/clear": "Clear conversation and start fresh",
  "/cost": "Show accumulated cost summary",
};

function handleReplCommand(
  command: string,
  session: AgentSession,
  options: LoopOptions,
  resetSession: () => void,
): boolean {
  switch (command) {
    case "/help": {
      const lines = Object.entries(REPL_COMMANDS).map(([cmd, desc]) => `  ${cmd.padEnd(10)} ${desc}`);
      lines.push("  exit       Quit interactive mode");
      console.error(lines.join("\n"));
      return true;
    }
    case "/status": {
      const state = session.getState();
      const model = options.model || "claude-sonnet-4-6";
      console.error(`Model: ${model}  State: ${state}  Cost: ${session.getCostSummary()}`);
      return true;
    }
    case "/reset":
    case "/clear": {
      resetSession();
      console.error("Conversation cleared.");
      return true;
    }
    case "/cost": {
      console.error(session.getCostSummary());
      return true;
    }
    default:
      return false;
  }
}

/**
 * Interactive REPL with persistent conversation context.
 * A single AgentSession is shared across all inputs — the agent
 * remembers previous turns and maintains running cost totals.
 */
export async function interactiveMode(options: LoopOptions, config?: KotaConfig) {
  let session = new AgentSession(options);

  const resetSession = () => {
    session.close();
    session = new AgentSession(options);
  };

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: "kota> ",
  });

  const scheduler = getScheduler();
  const stopScheduler = scheduler.startTimer(30_000, (dueItems) => {
    for (const item of dueItems) {
      console.error(`\n[kota] ⏰ Reminder: ${item.description}`);
    }
  });

  console.error("KOTA — interactive mode. Type /help for commands, or 'exit' to quit.\n");
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

    if (handleReplCommand(input, session, options, resetSession)) {
      console.log();
      rl.prompt();
      return;
    }

    input = expandAlias(input, config?.aliases);

    try {
      await session.send(input);
    } catch (err) {
      const authMsg = formatAuthError(err as Error);
      if (authMsg) {
        console.error(authMsg);
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
    }
    console.log();
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
    autonomyMode: "autonomous",
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
