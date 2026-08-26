import type { PendingApproval } from "#core/daemon/approval-queue.js";
import type { WorkflowRunSummary } from "#core/daemon/daemon-control.js";
import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import type { SemanticRole } from "#modules/rendering/primitives.js";
import type { ModuleSetupRequirementStatus } from "#modules/setup/client.js";
import type {
  KotaClientPort,
  ScopedKotaClientPort,
} from "#root/client/kota-client.generated.js";
import { gatherStatus, type StatusSnapshot } from "./status-cli.js";

export type OperatorInboxKind =
  | "runtime"
  | "approval"
  | "owner-question"
  | "blocked-task"
  | "setup"
  | "failed-run";

export type OperatorInboxItem = {
  kind: OperatorInboxKind;
  id: string;
  title: string;
  detail: string;
  action: string;
  role: SemanticRole;
  createdAt?: string;
};

export type OperatorInboxSnapshot = {
  scopeRoot: string;
  generatedAt: string;
  items: OperatorInboxItem[];
  counts: Record<OperatorInboxKind, number>;
};

const EMPTY_OPERATOR_INBOX_COUNTS: Record<OperatorInboxKind, number> = {
  runtime: 0,
  approval: 0,
  "owner-question": 0,
  "blocked-task": 0,
  setup: 0,
  "failed-run": 0,
};

function truncate(value: string, max = 140): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 3)}...`;
}

function countItems(items: OperatorInboxItem[]): Record<OperatorInboxKind, number> {
  const counts = { ...EMPTY_OPERATOR_INBOX_COUNTS };
  for (const item of items) counts[item.kind] += 1;
  return counts;
}

export function buildOperatorRuntimeInboxItems(
  status: StatusSnapshot,
): OperatorInboxItem[] {
  const items: OperatorInboxItem[] = [];
  if (!status.daemonRunning) {
    items.push({
      kind: "runtime",
      id: "daemon-offline",
      title: "Daemon is offline",
      detail: "Dispatch, event stream, and live sessions are unavailable.",
      action: "kota daemon start",
      role: "warn",
    });
  }
  if (status.controlFile.kind === "stale") {
    items.push({
      kind: "runtime",
      id: "daemon-control-stale",
      title: "Daemon control file is stale",
      detail: `Recorded pid ${status.controlFile.pid} is no longer alive.`,
      action: "kota doctor --fix",
      role: "warn",
    });
  } else if (status.controlFile.kind === "unreadable") {
    items.push({
      kind: "runtime",
      id: "daemon-control-unreadable",
      title: "Daemon control file is unreadable",
      detail: "KOTA cannot parse .kota/daemon-control.json.",
      action: "kota doctor --fix",
      role: "error",
    });
  }
  if (
    !status.daemonRunning &&
    (status.activeRuns > 0 || status.queuedRuns > 0 || status.workflowPaused)
  ) {
    const paused = status.workflowPaused ? "; operator pause present" : "";
    items.push({
      kind: "runtime",
      id: "offline-workflow-store",
      title: "Durable workflow state needs review",
      detail: `${status.activeRuns} active and ${status.queuedRuns} queued durable run(s)${paused}.`,
      action: "kota status --explain",
      role: "warn",
    });
  }
  return items;
}

function approvalItem(item: PendingApproval): OperatorInboxItem {
  return {
    kind: "approval",
    id: item.id,
    title: `Approval required: ${item.tool}`,
    detail: truncate(`${item.risk} risk — ${item.reason}`),
    action: `kota approval list`,
    role: item.risk === "dangerous" ? "error" : "warn",
    createdAt: item.createdAt,
  };
}

function ownerQuestionItem(item: PendingOwnerQuestion): OperatorInboxItem {
  return {
    kind: "owner-question",
    id: item.id,
    title: truncate(item.question, 100),
    detail: truncate(item.reason),
    action: `kota owner-question show ${item.id}`,
    role: "accent",
    createdAt: item.createdAt,
  };
}

function extractUnblockKind(content: string): string {
  const match = content.match(/^kind:\s*([a-z-]+)/m);
  if (!match) throw new Error("Blocked task is missing typed unblock precondition");
  return match[1];
}

async function blockedTaskItems(
  client: KotaClientPort<"tasks">,
  limit: number,
): Promise<OperatorInboxItem[]> {
  const result = await client.tasks.list(["blocked"]);
  const shown = result.tasks.slice(0, limit);
  const items: OperatorInboxItem[] = [];
  for (const task of shown) {
    const detail = await client.tasks.show(task.id);
    if (!detail.found) throw new Error(`Blocked task ${task.id} disappeared before inbox projection`);
    const unblockKind = extractUnblockKind(detail.content);
    items.push({
      kind: "blocked-task",
      id: task.id,
      title: task.title,
      detail: `priority=${task.priority}; unblock=${unblockKind}`,
      action: `kota task show ${task.id}`,
      role: unblockKind === "owner-decision" || unblockKind === "operator-capture" ? "warn" : "muted",
    });
  }
  return items;
}

function setupItem(req: ModuleSetupRequirementStatus): OperatorInboxItem {
  return {
    kind: "setup",
    id: `${req.moduleName}/${req.requirementId}`,
    title: `${req.moduleName}: ${req.title}`,
    detail: `${req.state} — ${req.message}`,
    action: `kota setup list`,
    role: req.required ? "warn" : "muted",
  };
}

function hiddenSetupItem(): OperatorInboxItem {
  return {
    kind: "setup",
    id: "visibility/hidden",
    title: "Setup requirements hidden by scope policy",
    detail: "hidden — change the scope setup visibility to inspect requirements",
    action: "kota setup list",
    role: "muted",
  };
}

function failedRunItem(run: WorkflowRunSummary): OperatorInboxItem {
  return {
    kind: "failed-run",
    id: run.id,
    title: `${run.workflow} ${run.status}`,
    detail: `started ${run.startedAt}${run.triggerEvent ? `; trigger=${run.triggerEvent}` : ""}`,
    action: `kota workflow show ${run.id}`,
    role: run.status === "failed" ? "error" : "warn",
    createdAt: run.startedAt,
  };
}

export async function buildOperatorInboxSnapshot(args: {
  client: ScopedKotaClientPort<
    "approvals" | "ownerQuestions" | "setup" | "tasks" | "workflow"
  >;
  scopeRoot: string;
  scopeId?: string;
  limit?: number;
  status?: StatusSnapshot;
}): Promise<OperatorInboxSnapshot> {
  const limit = args.limit ?? 20;
  const client = args.scopeId ? args.client.forScope(args.scopeId) : args.client;
  const status = args.status ?? await gatherStatus(
    args.scopeRoot,
    args.scopeId ? { scopeId: args.scopeId } : {},
  );

  const approvals = await client.approvals.list({ status: "pending" });
  const questions = await client.ownerQuestions.list({ status: "pending" });
  const blocked = await blockedTaskItems(client, limit);
  const setup = await client.setup.list();
  const runs = await client.workflow.listRuns({ limit });

  const setupItems = setup.visibility === "hidden"
    ? [hiddenSetupItem()]
    : setup.requirements
      .filter((req) => req.state !== "ready")
      .slice(0, limit)
      .map(setupItem);

  const failedRuns = runs.runs
    .filter((run) => run.status === "failed" || run.status === "interrupted")
    .slice(0, limit)
    .map(failedRunItem);

  const items = [
    ...buildOperatorRuntimeInboxItems(status),
    ...approvals.approvals.slice(0, limit).map(approvalItem),
    ...questions.questions.slice(0, limit).map(ownerQuestionItem),
    ...blocked,
    ...setupItems,
    ...failedRuns,
  ];

  return {
    scopeRoot: args.scopeRoot,
    generatedAt: new Date().toISOString(),
    items,
    counts: countItems(items),
  };
}
