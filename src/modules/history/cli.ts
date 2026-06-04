import {
  accessSync,
  constants,
  statSync,
} from "node:fs";
import { isAbsolute } from "node:path";
import { createInterface } from "node:readline";
import { resolveChannelAutonomyMode } from "#core/config/autonomy-mode-resolver.js";
import { expandAlias, type KotaConfig, loadConfig } from "#core/config/config.js";
import { getScheduler, resetScheduler } from "#core/daemon/scheduler.js";
import { AgentSession, type LoopOptions, runAgentLoop } from "#core/loop/loop.js";
import {
  createAskUserMcpAuthorizationResolver,
  createAskUserMcpInputResolver,
} from "#core/mcp/operator-input.js";
import { formatAuthError } from "#core/model/auth-error.js";
import { createModelClient } from "#core/model/model-client.js";
import { resolveActivePresetFromConfig } from "#core/model/preset.js";
import { ensureCliProvidersFor } from "#core/modules/cli-providers.js";
import type { ConversationRecord } from "#core/modules/provider-types.js";
import { expandUserPromptReferences } from "#core/prompt-input/index.js";
import type { KotaClient } from "#core/server/kota-client.js";
import { blank, line, plain, span } from "#modules/rendering/primitives.js";
import { print, TerminalTransport } from "#modules/rendering/transport.js";

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

export type ResumeConversationSelection = {
  id: string;
  record: ConversationRecord;
  projectDir: string;
  savedCwd: string;
  cwdOverridden: boolean;
  explicit: boolean;
};

export type ResumeCwdValidation =
  | { ok: true; cwd: string }
  | { ok: false; message: string };

type ConversationRecordLookup =
  | { status: "found"; record: ConversationRecord }
  | { status: "ambiguous"; ids: string[] };

type ConversationRecordResolveOptions = {
  crossProject?: boolean;
};

function resumeCwdHelp(): string {
  return "Pass --resume-here to resume in the current directory instead.";
}

/** Validate the saved conversation cwd before rebinding a resumed session to it. */
export function validateConversationResumeCwd(
  record: ConversationRecord,
): ResumeCwdValidation {
  const cwd = record.cwd.trim();
  if (!cwd) {
    return {
      ok: false,
      message: `Conversation "${record.id}" has no saved cwd. ${resumeCwdHelp()}`,
    };
  }
  if (!isAbsolute(cwd)) {
    return {
      ok: false,
      message:
        `Conversation "${record.id}" saved cwd is not absolute: ${cwd}. ` +
        resumeCwdHelp(),
    };
  }
  try {
    const stat = statSync(cwd);
    if (!stat.isDirectory()) {
      return {
        ok: false,
        message:
          `Conversation "${record.id}" saved cwd is not a directory: ${cwd}. ` +
          resumeCwdHelp(),
      };
    }
  } catch {
    return {
      ok: false,
      message:
        `Conversation "${record.id}" saved cwd is missing or inaccessible: ${cwd}. ` +
        resumeCwdHelp(),
    };
  }
  try {
    accessSync(cwd, constants.R_OK | constants.X_OK);
  } catch {
    return {
      ok: false,
      message:
        `Conversation "${record.id}" saved cwd is not readable/searchable: ${cwd}. ` +
        resumeCwdHelp(),
    };
  }
  return { ok: true, cwd };
}

/**
 * Resolve an ID or prefix to a full conversation ID via the contract.
 *
 * Pulls a sized list from `client.history.list()` (the underlying store
 * paginates by ts-desc; the cap matches the store's prune threshold) and
 * walks it to find an exact id match first, then unique-prefix match.
 * Exits with a clear error on miss or ambiguous prefix.
 */
export async function resolveConversationId(
  client: KotaClient,
  idOrPrefix: string,
): Promise<string> {
  return (await resolveConversationRecord(client, idOrPrefix)).id;
}

export async function resolveConversationRecord(
  client: KotaClient,
  idOrPrefix: string,
  options: ConversationRecordResolveOptions = {},
): Promise<ConversationRecord> {
  const trimmed = idOrPrefix.trim();
  if (!trimmed) {
    stderrTransport().write(line(span(`Conversation "${idOrPrefix}" not found.`, "error")));
    process.exit(1);
  }
  const { conversations } = await client.history.list({ limit: 10_000 });
  const activeLookup = resolveRecordFromList(conversations, trimmed);
  if (activeLookup?.status === "found") return activeLookup.record;
  if (activeLookup?.status === "ambiguous") {
    exitAmbiguousConversationPrefix(trimmed, activeLookup.ids);
  }

  if (options.crossProject) {
    const configuredLookup = await resolveRecordFromConfiguredProjects(
      client,
      trimmed,
    );
    if (configuredLookup?.status === "found") return configuredLookup.record;
    if (configuredLookup?.status === "ambiguous") {
      exitAmbiguousConversationPrefix(trimmed, configuredLookup.ids);
    }

    const localLookup = await resolveRecordFromDiscoveredProjectHistories(
      client,
      trimmed,
    );
    if (localLookup?.status === "found") return localLookup.record;
    if (localLookup?.status === "ambiguous") {
      exitAmbiguousConversationPrefix(trimmed, localLookup.ids);
    }
  }

  stderrTransport().write(line(span(`Conversation "${idOrPrefix}" not found.`, "error")));
  process.exit(1);
}

export async function resolveExplicitConversationResume(
  client: KotaClient,
  idOrPrefix: string,
  opts: { resumeHere?: boolean } = {},
): Promise<ResumeConversationSelection> {
  const record = await resolveConversationRecord(client, idOrPrefix, {
    crossProject: true,
  });
  const savedCwd = record.cwd;
  if (opts.resumeHere) {
    return {
      id: record.id,
      record,
      projectDir: process.cwd(),
      savedCwd,
      cwdOverridden: true,
      explicit: true,
    };
  }
  const validation = validateConversationResumeCwd(record);
  if (!validation.ok) {
    stderrTransport().write(line(span(validation.message, "error")));
    process.exit(1);
  }
  return {
    id: record.id,
    record,
    projectDir: validation.cwd,
    savedCwd,
    cwdOverridden: false,
    explicit: true,
  };
}

function resolveRecordFromList(
  conversations: ConversationRecord[],
  trimmed: string,
): ConversationRecordLookup | undefined {
  const exact = conversations.filter((c: ConversationRecord) => c.id === trimmed);
  if (exact.length === 1) return { status: "found", record: exact[0] };
  if (exact.length > 1) {
    return { status: "ambiguous", ids: exact.map((c) => c.id) };
  }
  const matches = conversations.filter((c: ConversationRecord) => c.id.startsWith(trimmed));
  if (matches.length === 0) return undefined;
  if (matches.length > 1) {
    return { status: "ambiguous", ids: matches.map((c) => c.id) };
  }
  return { status: "found", record: matches[0] };
}

function exitAmbiguousConversationPrefix(trimmed: string, ids: string[]): never {
  stderrTransport().write(line(span(
    `Ambiguous ID prefix "${trimmed}" matches ${ids.length} conversations: ${ids.join(", ")}`,
    "error",
  )));
  process.exit(1);
}

async function resolveRecordFromConfiguredProjects(
  client: KotaClient,
  trimmed: string,
): Promise<ConversationRecordLookup | undefined> {
  try {
    const projects = await client.projects.list();
    if (!projects.ok) return undefined;
    const conversations: ConversationRecord[] = [];
    for (const project of projects.projects) {
      const scoped = client.forProject(project.projectId);
      const listed = await scoped.history.list({ limit: 10_000 });
      conversations.push(...listed.conversations);
    }
    return resolveRecordFromList(conversations, trimmed);
  } catch {
    return undefined;
  }
}

async function resolveRecordFromDiscoveredProjectHistories(
  client: KotaClient,
  trimmed: string,
): Promise<ConversationRecordLookup | undefined> {
  try {
    const { conversations } = await client.history.listDiscoveredProjectRecords({
      limit: 10_000,
    });
    return resolveRecordFromList(conversations, trimmed);
  } catch {
    return undefined;
  }
}

export function reportResumeCwdSelection(
  selection: ResumeConversationSelection | undefined,
): void {
  if (!selection?.explicit) return;
  const stderr = stderrTransport();
  if (selection.cwdOverridden) {
    stderr.write(
      line(
        span("[kota] Resume cwd override: ", "warn"),
        plain(`using ${selection.projectDir} instead of saved cwd ${selection.savedCwd || "(not recorded)"}`),
      ),
    );
    return;
  }
  stderr.write(
    line(
      span("[kota] Resume cwd: ", "muted"),
      plain(`using saved directory ${selection.projectDir}`),
    ),
  );
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
      const model =
        options.model ||
        resolveActivePresetFromConfig(options.config).defaultModel;
      stderr.write(
        line(
          span("Model: ", "muted"),
          span(model, "info"),
          plain("  "),
          span("State: ", "muted"),
          plain(state),
          plain("  "),
          span("Project: ", "muted"),
          plain(session.projectDir),
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
    input = expandUserPromptReferences(input, session.projectDir).text;

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

/**
 * Resolve `kota run --continue` to a conversation id.
 *
 * Returns `undefined` when `--continue` is unset. With a string id resolves
 * that prefix through the contract; with a bare flag picks the most recent
 * conversation for the current cwd. Exits when no candidate is found.
 */
export async function resolveRunContinue(
  client: KotaClient,
  opts: { continue?: boolean | string; resumeHere?: boolean },
): Promise<ResumeConversationSelection | undefined> {
  if (!opts.continue) return undefined;
  await ensureCliProvidersFor(["history"]);
  if (typeof opts.continue === "string") {
    return resolveExplicitConversationResume(client, opts.continue, {
      resumeHere: opts.resumeHere,
    });
  }
  const { conversations } = await client.history.list({
    cwd: process.cwd(),
    limit: 1,
  });
  if (conversations.length > 0) {
    const record = conversations[0];
    return {
      id: record.id,
      record,
      projectDir: process.cwd(),
      savedCwd: record.cwd,
      cwdOverridden: false,
      explicit: false,
    };
  }
  stderrTransport().write(
    line(span("No previous conversation found for this directory.", "error")),
  );
  process.exit(1);
}

/** Execute the pipe-mode agent loop (shared between checkPipeMode paths). */
export async function runPipeLoop(piped: string): Promise<void> {
  const config = loadConfig();
  const resolved = createModelClient({
    model: config.model || resolveActivePresetFromConfig(config).defaultModel,
    provider: config.modelProvider?.type,
    baseUrl: config.modelProvider?.baseUrl,
    apiKey: config.modelProvider?.apiKey,
    projectDir: process.cwd(),
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
    mcpInputResolver: createAskUserMcpInputResolver(),
    mcpAuthorizationResolver: createAskUserMcpAuthorizationResolver(),
  });
}
