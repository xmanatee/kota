import type { KotaClient } from "#core/server/kota-client.js";
import {
  blank,
  heading,
  type LineNode,
  line,
  plain,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import type { NavigatorOutput, NavigatorPrompt, ScreenName } from "./navigator-types.js";

export async function openScreen(
  screen: ScreenName,
  client: KotaClient,
  prompt: NavigatorPrompt,
  output: NavigatorOutput,
): Promise<void> {
  switch (screen) {
    case "status":
      await statusScreen(client, output);
      return;
    case "inbox":
      await inboxScreen(client, prompt, output);
      return;
    case "work":
      await workScreen(client, output);
      return;
    case "knowledge":
      await knowledgeWorkspaceScreen(client, output);
      return;
    case "setup":
      await setupScreen(client, prompt, output);
      return;
  }
}

async function statusScreen(
  client: KotaClient,
  output: NavigatorOutput,
): Promise<void> {
  const daemon = await callOrError(output, "daemonOps.status", () => client.daemonOps.status());
  if (!daemon) return;
  const projects = await callOrError(output, "projects.list", () => client.projects.list());
  const projectLine = projects?.ok
    ? projects.projects.find((project) => project.projectId === projects.activeProjectId)?.displayName
      ?? projects.projects.find((project) => project.projectId === projects.defaultProjectId)?.displayName
      ?? "default"
    : "local";
  const rows: LineNode[] = [
    line(span("  Project", "muted"), plain("  "), plain(projectLine)),
  ];
  if (daemon.state === "running") {
    rows.push(
      line(span("  Daemon", "muted"), plain("   "), span(`running pid ${daemon.status.pid}`, "success")),
      line(span("  Runs", "muted"), plain("     "), plain(`${daemon.status.workflow.activeRuns.length} active, ${daemon.status.workflow.queueLength} queued`)),
      line(span("  Sessions", "muted"), plain(" "), plain(`${daemon.status.sessions.length} interactive`)),
    );
  } else {
    rows.push(line(span("  Daemon", "muted"), plain("   "), span(daemon.state.replace(/_/g, " "), "warn")));
  }
  output.write(stack(heading("Status", 2), ...rows, blank()));
}

async function inboxScreen(
  client: KotaClient,
  prompt: NavigatorPrompt,
  output: NavigatorOutput,
): Promise<void> {
  const approvals = await callOrError(output, "approvals.list", () => client.approvals.list({ status: "pending" }));
  const questions = await callOrError(output, "ownerQuestions.list", () => client.ownerQuestions.list({ status: "pending" }));
  const blocked = await callOrError(output, "tasks.list", () => client.tasks.list(["blocked"]));
  const setup = await callOrError(output, "setup.list", () => client.setup.list());
  const runs = await callOrError(output, "workflow.listRuns", () => client.workflow.listRuns({ limit: 20 }));
  if (!approvals || !questions || !blocked || !setup || !runs) return;

  const failedRuns = runs.runs.filter((run) => run.status === "failed" || run.status === "interrupted");
  const missingSetup = setup.requirements.filter((req) => req.state !== "ready");
  const rows: LineNode[] = [
    line(span("  Approvals", approvals.approvals.length > 0 ? "warn" : "muted"), plain(`       ${approvals.approvals.length}`)),
    line(span("  Owner questions", questions.questions.length > 0 ? "warn" : "muted"), plain(` ${questions.questions.length}`)),
    line(span("  Blocked tasks", blocked.tasks.length > 0 ? "warn" : "muted"), plain(`    ${blocked.tasks.length}`)),
    line(span("  Setup gaps", missingSetup.length > 0 ? "warn" : "muted"), plain(`       ${missingSetup.length}`)),
    line(span("  Failed runs", failedRuns.length > 0 ? "error" : "muted"), plain(`       ${failedRuns.length}`)),
  ];
  const details: LineNode[] = [
    ...approvals.approvals.slice(0, 5).map((item) =>
      line(span(`  approval ${item.id}`, "accent"), plain("  "), span(item.tool, "muted")),
    ),
    ...questions.questions.slice(0, 5).map((item) =>
      line(span(`  question ${item.id}`, "accent"), plain("  "), plain(truncate(item.question, 80))),
    ),
    ...blocked.tasks.slice(0, 5).map((item) =>
      line(span(`  blocked ${item.id}`, "accent"), plain("  "), plain(item.title)),
    ),
    ...missingSetup.slice(0, 5).map((item) =>
      line(span(`  setup ${item.moduleName}/${item.requirementId}`, "accent"), plain("  "), plain(item.title)),
    ),
    ...failedRuns.slice(0, 5).map((item) =>
      line(span(`  run ${item.id}`, "accent"), plain("  "), plain(`${item.workflow} ${item.status}`)),
    ),
  ];
  output.write(stack(
    heading("Inbox", 2),
    ...rows,
    blank(),
    ...(details.length === 0 ? [line(span("No operator attention items.", "success"))] : details),
    blank(),
  ));

  if (approvals.approvals.length === 0) return;
  const action = await prompt.ask('Approve / reject? "<id> approve|reject [reason]", enter to skip: ');
  if (action === null) return;
  const trimmed = action.trim();
  if (trimmed === "") return;
  await resolveApprovalAction(client, output, trimmed);
}

async function resolveApprovalAction(
  client: KotaClient,
  output: NavigatorOutput,
  action: string,
): Promise<void> {
  const parts = action.split(/\s+/);
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
  if (mutation.reason === "invalid_id") {
    output.write(line(span(`Invalid approval id "${id}". Expected 8 lowercase hex characters.`, "warn")));
    return;
  }
  if (mutation.reason === "input_unavailable") {
    output.write(line(span(`Approval "${id}" cannot execute after daemon restart; reject it and retry the tool call.`, "warn")));
    return;
  }
  output.write(line(span(`Approval "${id}" not found or already resolved.`, "warn")));
}

async function workScreen(
  client: KotaClient,
  output: NavigatorOutput,
): Promise<void> {
  const definitions = await callOrError(output, "workflow.listDefinitions", () => client.workflow.listDefinitions());
  const runs = await callOrError(output, "workflow.listRuns", () => client.workflow.listRuns({ limit: 10 }));
  const tasks = await callOrError(output, "tasks.list", () => client.tasks.list());
  const sessions = await callOrError(output, "sessions.list", () => client.sessions.list());
  if (!definitions || !runs || !tasks || !sessions) return;
  output.write(stack(
    heading("Work", 2),
    line(span("  Automations", "muted"), plain(` ${definitions.definitions.length}`)),
    line(span("  Runs", "muted"), plain(`        ${runs.runs.length}`)),
    line(span("  Tasks", "muted"), plain(`       ${tasks.tasks.length}`)),
    line(span("  Sessions", "muted"), plain(`    ${sessions.sessions.length}`)),
    blank(),
    ...definitions.definitions.slice(0, 8).map((def) =>
      line(span(`  ${def.name}`, "accent"), plain("  "), span(`${def.stepCount} steps`, "muted")),
    ),
    ...tasks.tasks.slice(0, 8).map((task) =>
      line(span(`  ${task.id}`, "accent"), plain("  "), plain(task.title)),
    ),
    blank(),
  ));
}

async function knowledgeWorkspaceScreen(
  client: KotaClient,
  output: NavigatorOutput,
): Promise<void> {
  const memory = await callOrError(output, "memory.list", () => client.memory.list({ limit: 5 }));
  const knowledge = await callOrError(output, "knowledge.list", () => client.knowledge.list());
  const history = await callOrError(output, "history.list", () => client.history.list({ limit: 5 }));
  if (!memory || !knowledge || !history) return;
  output.write(stack(
    heading("Knowledge", 2),
    line(span("  Memory", "muted"), plain(`    ${memory.entries.length}`)),
    line(span("  Knowledge", "muted"), plain(` ${knowledge.entries.length}`)),
    line(span("  History", "muted"), plain(`   ${history.conversations.length}`)),
    blank(),
    ...knowledge.entries.slice(0, 8).map((entry) =>
      line(span(`  ${entry.id}`, "accent"), plain("  "), plain(entry.title)),
    ),
    ...history.conversations.slice(0, 5).map((entry) =>
      line(span(`  ${entry.id}`, "accent"), plain("  "), plain(entry.title)),
    ),
    blank(),
  ));
}

async function setupScreen(
  client: KotaClient,
  prompt: NavigatorPrompt,
  output: NavigatorOutput,
): Promise<void> {
  const setup = await callOrError(output, "setup.list", () => client.setup.list());
  const modules = await callOrError(output, "modules.list", () => client.modules.list());
  const secrets = await callOrError(output, "secrets.list", () => client.secrets.list());
  if (!setup || !modules || !secrets) return;
  const missing = setup.requirements.filter((req) => req.state !== "ready");
  output.write(stack(
    heading("Setup", 2),
    line(span("  Modules", "muted"), plain(` ${modules.modules.length}`)),
    line(span("  Setup gaps", missing.length > 0 ? "warn" : "muted"), plain(` ${missing.length}`)),
    line(span("  Secrets", "muted"), plain(` ${secrets.secrets.length}`)),
    blank(),
    ...modules.modules.slice(0, 10).map((mod) =>
      line(span(`  ${mod.name}`, mod.status === "failed" ? "error" : "accent"), plain("  "), span(mod.source, "muted")),
    ),
    ...missing.slice(0, 10).map((req) =>
      line(span(`  ${req.moduleName}/${req.requirementId}`, "accent"), plain("  "), plain(req.title)),
    ),
    blank(),
  ));
  if (secrets.secrets.length === 0) return;
  const action = await prompt.ask('Remove a secret? "<name> project|global", enter to skip: ');
  if (action === null) return;
  const trimmed = action.trim();
  if (trimmed === "") return;
  await resolveSecretRemoval(client, output, trimmed);
}

async function resolveSecretRemoval(
  client: KotaClient,
  output: NavigatorOutput,
  action: string,
): Promise<void> {
  const parts = action.split(/\s+/);
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
