import { createInterface } from "node:readline";
import { resolveChannelAutonomyMode } from "#core/config/autonomy-mode-resolver.js";
import { expandAlias, type KotaConfig, loadConfig } from "#core/config/config.js";
import { getScheduler, resetScheduler } from "#core/daemon/scheduler.js";
import { AgentSession, type LoopOptions, runAgentLoop } from "#core/loop/loop.js";
import { formatAuthError } from "#core/model/auth-error.js";
import { createModelClient } from "#core/model/model-client.js";
import { blank, line, plain, span } from "#modules/rendering/primitives.js";
import { print, TerminalTransport } from "#modules/rendering/transport.js";
import { type ConversationHistory, getHistory } from "./history.js";

export { registerHistoryCommands } from "./cli-commands.js";

let stderrRenderer: TerminalTransport | null = null;

function stderrTransport(): TerminalTransport {
  if (!stderrRenderer) stderrRenderer = new TerminalTransport({ stream: process.stderr });
  return stderrRenderer;
}

/** Parse a CLI numeric option, exiting with a clear message on invalid input. */
export function parseIntOption(value: string, name: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    stderrTransport().write(
      line(span(`Error: --${name} must be a positive integer, got "${value}"`, "error")),
    );
    process.exit(1);
  }
  return n;
}

/** Resolve an ID or prefix to a full conversation ID. Exits on failure. */
export function resolveConversationId(history: ConversationHistory, idOrPrefix: string): string {
  try {
    const record = history.findByPrefix(idOrPrefix);
    if (!record) {
      stderrTransport().write(line(span(`Conversation "${idOrPrefix}" not found.`, "error")));
      process.exit(1);
    }
    return record.id;
  } catch (err) {
    stderrTransport().write(line(span((err as Error).message, "error")));
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
  const stderr = stderrTransport();
  switch (command) {
    case "/help": {
      const items = Object.entries(REPL_COMMANDS).map(([cmd, desc]) =>
        line(span(`  ${cmd.padEnd(10)}`, "accent"), plain(` ${desc}`)),
      );
      items.push(line(span("  exit      ", "accent"), plain(" Quit interactive mode")));
      for (const item of items) stderr.write(item);
      return true;
    }
    case "/status": {
      const state = session.getState();
      const model = options.model || "claude-sonnet-4-6";
      stderr.write(
        line(
          span("Model: ", "muted"),
          span(model, "info"),
          plain("  "),
          span("State: ", "muted"),
          plain(state),
          plain("  "),
          span("Cost: ", "muted"),
          plain(session.getCostSummary()),
        ),
      );
      return true;
    }
    case "/reset":
    case "/clear": {
      resetSession();
      stderr.write(line(span("Conversation cleared.", "success")));
      return true;
    }
    case "/cost": {
      stderr.write(line(plain(session.getCostSummary())));
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
  const stderr = stderrTransport();

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
      stderr.write(blank());
      stderr.write(line(span(`[kota] ⏰ Reminder: ${item.description}`, "accent")));
    }
  });

  stderr.write(
    line(span("KOTA", "agent", true), plain(" — interactive mode. Type /help for commands, or 'exit' to quit.")),
  );
  stderr.write(blank());
  rl.prompt();

  rl.on("line", async (rawLine) => {
    let input = rawLine.trim();
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
      print(blank());
      rl.prompt();
      return;
    }

    input = expandAlias(input, config?.aliases);

    try {
      await session.send(input);
    } catch (err) {
      const authMsg = formatAuthError(err as Error);
      stderr.write(
        line(span(authMsg ?? `Error: ${(err as Error).message}`, "error")),
      );
    }
    print(blank());
    rl.prompt();
  });

  rl.on("close", () => {
    stopScheduler();
    resetScheduler();
    session.close();
    stderr.write(blank());
    stderr.write(line(span("Goodbye.", "muted")));
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
  stderrTransport().write(
    line(span("No previous conversation found for this directory.", "error")),
  );
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
    autonomyMode: resolveChannelAutonomyMode(
      config.cli?.defaultAutonomyMode,
      config,
      "cli pipe",
    ),
    model: resolved.model,
    maxTokens: config.maxTokens || 8192,
    verbose: config.verbose,
    thinkingEnabled: config.thinking,
    thinkingBudget: config.thinking ? (config.thinkingBudget || 10000) : undefined,
    config,
    client: resolved.client,
  });
}
