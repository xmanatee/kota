/**
 * Interactive runtime navigator.
 *
 * The navigator is a menu-driven TTY client over the `KotaClient` contract.
 * Each screen reads from one or more contract namespaces and offers the
 * supported mutations inline; the main menu is the only routing surface.
 *
 * Composition is plain TypeScript: a screen is an async function over the
 * client and a small `Prompt` interface that abstracts readline input. Tests
 * inject a scripted prompt + capture transport and assert on the rendered
 * frames; production wires the real readline and the shared
 * `TerminalTransport`.
 */
import { createInterface } from "node:readline";
import type {
  KotaClient,
  SessionsSetAutonomyModeResult,
} from "#core/server/kota-client.js";
import { isAutonomyMode } from "#core/tools/autonomy-mode.js";
import type { ModuleListEntry } from "#modules/module-manager/client.js";
import {
  blank,
  heading,
  type LineNode,
  line,
  list,
  plain,
  type RenderNode,
  span,
  stack,
} from "#modules/rendering/primitives.js";

/** Minimal input surface so tests can drive the navigator deterministically. */
export interface NavigatorPrompt {
  /** Read one line of input. Returns null on EOF (Ctrl-D / closed stream). */
  ask(prompt: string): Promise<string | null>;
  /** Release any held resources. */
  close(): void;
}

/** Rendering surface — the production transport implements `write(node)`. */
export interface NavigatorOutput {
  write(node: RenderNode): void;
}

export type NavigatorOptions = {
  client: KotaClient;
  prompt: NavigatorPrompt;
  output: NavigatorOutput;
};

type ScreenName =
  | "sessions"
  | "modules"
  | "workflows"
  | "approvals"
  | "tasks"
  | "secrets"
  | "memory"
  | "knowledge"
  | "history"
  | "owner-questions";

type MenuEntry = { key: string; label: string; screen: ScreenName };

const MENU: MenuEntry[] = [
  { key: "1", label: "Sessions", screen: "sessions" },
  { key: "2", label: "Modules", screen: "modules" },
  { key: "3", label: "Workflows", screen: "workflows" },
  { key: "4", label: "Approvals", screen: "approvals" },
  { key: "5", label: "Tasks", screen: "tasks" },
  { key: "6", label: "Secrets", screen: "secrets" },
  { key: "7", label: "Memory", screen: "memory" },
  { key: "8", label: "Knowledge", screen: "knowledge" },
  { key: "9", label: "History", screen: "history" },
  { key: "0", label: "Owner questions", screen: "owner-questions" },
];

/**
 * The well-known stderr hint surfaced when stdin is not a TTY. Kept exported
 * so tests can assert against the exact string.
 */
export const NON_TTY_HINT =
  'kota navigate is interactive only. Run a one-shot subcommand instead — e.g. "kota approval list", "kota module list", "kota workflow status".';

export function refuseNonTtyLaunch(stderr: NodeJS.WritableStream): void {
  stderr.write(`${NON_TTY_HINT}\n`);
}

/** Build the menu render tree. Pure so tests can inspect it. */
export function renderMainMenu(): RenderNode {
  return stack(
    heading("KOTA navigator", 1),
    line(span("Pick a category, q to quit, ? for help.", "muted")),
    blank(),
    list(MENU.map((entry) => ({
      spans: [
        span(`${entry.key} `, "accent", true),
        plain(entry.label),
      ],
    }))),
    blank(),
  );
}

/**
 * Run the navigator until the user quits. Pure I/O loop — every screen call
 * goes through the supplied client and the output transport.
 */
export async function runNavigator(opts: NavigatorOptions): Promise<void> {
  const { client, prompt, output } = opts;
  try {
    output.write(renderMainMenu());
    while (true) {
      const raw = await prompt.ask("kota> ");
      if (raw === null) return;
      const input = raw.trim().toLowerCase();
      if (input === "" || input === "?" || input === "h" || input === "help") {
        output.write(renderMainMenu());
        continue;
      }
      if (input === "q" || input === "quit" || input === "exit") return;
      const entry = MENU.find((m) => m.key === input || m.label.toLowerCase().startsWith(input));
      if (!entry) {
        output.write(line(span(`Unknown selection "${raw}". Type ? for the menu, q to quit.`, "warn")));
        continue;
      }
      await openScreen(entry.screen, client, prompt, output);
      output.write(renderMainMenu());
    }
  } finally {
    prompt.close();
  }
}

async function openScreen(
  screen: ScreenName,
  client: KotaClient,
  prompt: NavigatorPrompt,
  output: NavigatorOutput,
): Promise<void> {
  switch (screen) {
    case "sessions":
      await sessionsScreen(client, prompt, output);
      return;
    case "modules":
      await modulesScreen(client, output);
      return;
    case "workflows":
      await workflowsScreen(client, prompt, output);
      return;
    case "approvals":
      await approvalsScreen(client, prompt, output);
      return;
    case "tasks":
      await tasksScreen(client, output);
      return;
    case "secrets":
      await secretsScreen(client, prompt, output);
      return;
    case "memory":
      await memoryScreen(client, output);
      return;
    case "knowledge":
      await knowledgeScreen(client, output);
      return;
    case "history":
      await historyScreen(client, output);
      return;
    case "owner-questions":
      await ownerQuestionsScreen(client, output);
      return;
  }
}

async function sessionsScreen(
  client: KotaClient,
  prompt: NavigatorPrompt,
  output: NavigatorOutput,
): Promise<void> {
  const result = await callOrError(output, "sessions.list", () => client.sessions.list());
  if (!result) return;
  if (result.sessions.length === 0) {
    output.write(stack(heading("Sessions", 2), line(span("No active sessions.", "muted"))));
    return;
  }
  const rows: LineNode[] = result.sessions.map((session) =>
    line(
      span(`  ${session.id}`, "accent"),
      plain("  "),
      span(session.autonomyMode, modeRole(session.autonomyMode)),
      plain("  "),
      span(session.source ?? "daemon", "muted"),
    ),
  );
  output.write(stack(heading("Sessions", 2), ...rows, blank()));
  const answer = await prompt.ask('Set autonomy mode? "<id> <mode>" (passive|supervised|autonomous), enter to skip: ');
  if (answer === null) return;
  const trimmed = answer.trim();
  if (trimmed === "") return;
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 2) {
    output.write(line(span("Expected two tokens: <session-id> <mode>.", "warn")));
    return;
  }
  const [id, mode] = parts;
  if (!isAutonomyMode(mode)) {
    output.write(line(span(`Unknown mode "${mode}". Use passive, supervised, or autonomous.`, "warn")));
    return;
  }
  const mutation: SessionsSetAutonomyModeResult = await client.sessions.setAutonomyMode(id, mode);
  if (mutation.ok) {
    const note = mutation.serveOwned
      ? " (serve-owned: registration metadata updated; the owning serve process holds the authoritative session)"
      : "";
    output.write(line(
      span("Updated ", "success"),
      span(id, "accent"),
      plain(` → ${mutation.autonomyMode}${note}`),
    ));
    return;
  }
  if (mutation.reason === "not_found") {
    output.write(line(span(`Session "${id}" not found.`, "warn")));
    return;
  }
  output.write(line(span("Daemon required to mutate sessions.", "warn")));
}

async function modulesScreen(
  client: KotaClient,
  output: NavigatorOutput,
): Promise<void> {
  const result = await callOrError(output, "modules.list", () => client.modules.list());
  if (!result) return;
  if (result.modules.length === 0) {
    output.write(stack(heading("Modules", 2), line(span("No modules loaded.", "muted"))));
    return;
  }
  output.write(stack(heading("Modules", 2), ...moduleRows(result.modules), blank()));
}

function moduleRows(modules: ModuleListEntry[]): LineNode[] {
  return modules.map((mod) => {
    const summaryParts = [
      `tools=${mod.toolCount}`,
      `wf=${mod.workflowCount}`,
      `cmd=${mod.commandCount}`,
      `ch=${mod.channelCount}`,
      `sk=${mod.skillCount}`,
      `ag=${mod.agentCount}`,
    ];
    return line(
      span(`  ${mod.name}`, mod.status === "failed" ? "error" : "accent"),
      plain("  "),
      span(`[${mod.source}]`, "muted"),
      plain("  "),
      span(summaryParts.join(" "), "muted"),
      plain("  "),
      span(mod.description ?? "", "muted"),
    );
  });
}

async function workflowsScreen(
  client: KotaClient,
  prompt: NavigatorPrompt,
  output: NavigatorOutput,
): Promise<void> {
  const result = await callOrError(output, "workflow.listDefinitions", () => client.workflow.listDefinitions());
  if (!result) return;
  if (result.definitions.length === 0) {
    output.write(stack(heading("Workflows", 2), line(span("No workflow definitions registered.", "muted"))));
    return;
  }
  const rows: LineNode[] = result.definitions.map((def) => {
    const enabled = def.runtimeEnabled ?? def.enabled;
    return line(
      span(`  ${def.name}`, "accent"),
      plain("  "),
      span(enabled ? "enabled" : "disabled", enabled ? "success" : "muted"),
      plain("  "),
      span(`steps=${def.stepCount}`, "muted"),
      plain("  "),
      span(`triggers=${def.triggers.map((t) => t.type).join(",") || "(none)"}`, "muted"),
    );
  });
  output.write(stack(
    heading("Workflows", 2),
    line(span(`source: ${result.source}`, "muted")),
    blank(),
    ...rows,
    blank(),
  ));
  const action = await prompt.ask('Toggle workflow? "<name> enable|disable", enter to skip: ');
  if (action === null) return;
  const trimmed = action.trim();
  if (trimmed === "") return;
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 2 || (parts[1] !== "enable" && parts[1] !== "disable")) {
    output.write(line(span('Expected "<name> enable|disable".', "warn")));
    return;
  }
  const [name, op] = parts;
  const mutation = op === "enable"
    ? await client.workflow.enable(name)
    : await client.workflow.disable(name);
  if (mutation.ok) {
    output.write(line(span(`Workflow ${name} ${op}d.`, "success")));
    return;
  }
  if (mutation.reason === "not_found") {
    output.write(line(span(`Workflow "${name}" not found.`, "warn")));
    return;
  }
  output.write(line(span("Daemon required to enable or disable workflows.", "warn")));
}

async function approvalsScreen(
  client: KotaClient,
  prompt: NavigatorPrompt,
  output: NavigatorOutput,
): Promise<void> {
  const result = await callOrError(output, "approvals.list", () =>
    client.approvals.list({ status: "pending" }),
  );
  if (!result) return;
  if (result.approvals.length === 0) {
    output.write(stack(heading("Approvals", 2), line(span("No pending approvals.", "muted"))));
    return;
  }
  const rows: LineNode[] = result.approvals.map((a) =>
    line(
      span(`  [${a.id}]`, "accent"),
      plain(" "),
      plain(a.tool),
      plain("  "),
      span(`risk=${a.risk}`, "muted"),
      plain("  "),
      span(a.reason, "muted"),
    ),
  );
  output.write(stack(heading("Approvals", 2), ...rows, blank()));
  const action = await prompt.ask('Approve / reject? "<id> approve|reject [reason]", enter to skip: ');
  if (action === null) return;
  const trimmed = action.trim();
  if (trimmed === "") return;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2 || (parts[1] !== "approve" && parts[1] !== "reject")) {
    output.write(line(span('Expected "<id> approve|reject [reason...]".', "warn")));
    return;
  }
  const id = parts[0];
  const op = parts[1];
  const note = parts.slice(2).join(" ") || undefined;
  const mutation = op === "approve"
    ? await client.approvals.approve(id, note)
    : await client.approvals.reject(id, note);
  if (mutation.ok) {
    output.write(line(span(`${op === "approve" ? "Approved" : "Rejected"} ${id}.`, "success")));
    return;
  }
  output.write(line(span(`Approval "${id}" not found or already resolved.`, "warn")));
}

async function tasksScreen(
  client: KotaClient,
  output: NavigatorOutput,
): Promise<void> {
  const result = await callOrError(output, "tasks.list", () => client.tasks.list());
  if (!result) return;
  if (result.tasks.length === 0) {
    output.write(stack(heading("Tasks", 2), line(span("No open tasks.", "muted"))));
    return;
  }
  const rows: LineNode[] = result.tasks.map((task) =>
    line(
      span(`  [${task.priority}]`, "muted"),
      plain(" "),
      span(task.id, "accent"),
      plain("  "),
      span(`(${task.state})`, "muted"),
      plain("  "),
      plain(task.title),
    ),
  );
  output.write(stack(heading("Tasks", 2), ...rows, blank()));
}

async function secretsScreen(
  client: KotaClient,
  prompt: NavigatorPrompt,
  output: NavigatorOutput,
): Promise<void> {
  const result = await callOrError(output, "secrets.list", () => client.secrets.list());
  if (!result) return;
  if (result.secrets.length === 0) {
    output.write(stack(heading("Secrets", 2), line(span("No secrets registered.", "muted"))));
    return;
  }
  const rows: LineNode[] = result.secrets.map((s) =>
    line(span(`  ${s.name}`, "accent"), plain("  "), span(`source=${s.source}`, "muted")),
  );
  output.write(stack(
    heading("Secrets", 2),
    line(span("Values are never rendered.", "muted")),
    blank(),
    ...rows,
    blank(),
  ));
  const action = await prompt.ask('Remove a secret? "<name> project|global", enter to skip: ');
  if (action === null) return;
  const trimmed = action.trim();
  if (trimmed === "") return;
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 2 || (parts[1] !== "project" && parts[1] !== "global")) {
    output.write(line(span('Expected "<name> project|global".', "warn")));
    return;
  }
  const [name, scope] = parts as [string, "project" | "global"];
  const mutation = await client.secrets.remove(name, scope);
  if (mutation.ok) {
    output.write(line(span(`Removed ${name} from ${scope}.`, "success")));
    return;
  }
  if (mutation.reason === "not_found") {
    output.write(line(span(`Secret "${name}" not found in ${scope}.`, "warn")));
    return;
  }
  output.write(line(span(`Failed to remove ${name}: ${mutation.message ?? "store error"}.`, "error")));
}

async function memoryScreen(
  client: KotaClient,
  output: NavigatorOutput,
): Promise<void> {
  const result = await callOrError(output, "memory.list", () => client.memory.list(20));
  if (!result) return;
  if (result.entries.length === 0) {
    output.write(stack(heading("Memory", 2), line(span("No memory entries.", "muted"))));
    return;
  }
  const rows: LineNode[] = result.entries.map((entry) =>
    line(
      span(`  ${entry.id}`, "accent"),
      plain("  "),
      span(entry.created, "muted"),
      plain("  "),
      plain(truncate(entry.content, 90)),
    ),
  );
  output.write(stack(heading("Memory", 2), ...rows, blank()));
}

async function knowledgeScreen(
  client: KotaClient,
  output: NavigatorOutput,
): Promise<void> {
  const result = await callOrError(output, "knowledge.list", () => client.knowledge.list());
  if (!result) return;
  if (result.entries.length === 0) {
    output.write(stack(heading("Knowledge", 2), line(span("No knowledge entries.", "muted"))));
    return;
  }
  const rows: LineNode[] = result.entries.slice(0, 50).map((entry) =>
    line(
      span(`  ${entry.id}`, "accent"),
      plain("  "),
      plain(entry.title),
    ),
  );
  output.write(stack(
    heading("Knowledge", 2),
    line(span(`showing ${Math.min(50, result.entries.length)} of ${result.entries.length}`, "muted")),
    blank(),
    ...rows,
    blank(),
  ));
}

async function historyScreen(
  client: KotaClient,
  output: NavigatorOutput,
): Promise<void> {
  const result = await callOrError(output, "history.list", () => client.history.list({ limit: 20 }));
  if (!result) return;
  if (result.conversations.length === 0) {
    output.write(stack(heading("History", 2), line(span("No conversations.", "muted"))));
    return;
  }
  const rows: LineNode[] = result.conversations.map((conv) =>
    line(
      span(`  ${conv.id}`, "accent"),
      plain("  "),
      span(conv.updatedAt, "muted"),
      plain("  "),
      plain(conv.title),
    ),
  );
  output.write(stack(heading("History", 2), ...rows, blank()));
}

async function ownerQuestionsScreen(
  client: KotaClient,
  output: NavigatorOutput,
): Promise<void> {
  const result = await callOrError(output, "ownerQuestions.list", () => client.ownerQuestions.list());
  if (!result) return;
  if (result.questions.length === 0) {
    output.write(stack(heading("Owner questions", 2), line(span("No pending owner questions.", "muted"))));
    return;
  }
  const rows: LineNode[] = result.questions.map((q) =>
    line(
      span(`  ${q.id}`, "accent"),
      plain("  "),
      plain(truncate(q.question, 100)),
    ),
  );
  output.write(stack(heading("Owner questions", 2), ...rows, blank()));
}

function modeRole(mode: string): "success" | "warn" | "muted" {
  switch (mode) {
    case "autonomous":
      return "warn";
    case "supervised":
      return "success";
    default:
      return "muted";
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

async function callOrError<T>(
  output: NavigatorOutput,
  label: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output.write(line(span(`Error from ${label}: ${msg}`, "error")));
    return null;
  }
}

/** Build a readline-backed prompt for production use. */
export function createReadlinePrompt(): NavigatorPrompt {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: process.stdin.isTTY === true,
  });
  return {
    ask: (text) =>
      new Promise<string | null>((resolve) => {
        let resolved = false;
        const onClose = () => {
          if (!resolved) {
            resolved = true;
            resolve(null);
          }
        };
        rl.once("close", onClose);
        rl.question(text, (answer) => {
          rl.removeListener("close", onClose);
          if (resolved) return;
          resolved = true;
          resolve(answer);
        });
      }),
    close: () => rl.close(),
  };
}
