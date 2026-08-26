import type { PendingApproval } from "#core/daemon/approval-queue.js";
import type { WorkflowDefinitionSummary } from "#core/daemon/daemon-control.js";
import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import type {
  UiAction,
  UiActionParameterSpec,
  UiLogEntry,
  UiTableRow,
} from "#core/daemon/ui-surface.js";
import {
  emptyRows,
  type SurfaceRead,
  shortId,
  unavailableRows,
} from "#core/daemon/ui-surface-builders.js";
import type {
  WorkflowDefinitionsResult,
  WorkflowRunsListResult,
  WorkflowStatusSnapshot,
} from "#modules/workflow-ops/client.js";

function triggerSummary(definition: WorkflowDefinitionSummary): string {
  if (definition.triggers.length === 0) return "manual";
  return definition.triggers.map((trigger) => {
    switch (trigger.type) {
      case "event":
        return trigger.event;
      case "cron":
        return trigger.schedule;
      case "interval":
        return `${trigger.intervalMs}ms`;
      case "webhook":
        return "webhook";
      case "watch":
        return trigger.patterns.join(",");
    }
  }).join(", ");
}

export function workflowRows(definitions: SurfaceRead<WorkflowDefinitionsResult>): UiTableRow[] {
  if (!definitions.ok) return unavailableRows(definitions.message);
  if (definitions.value.definitions.length === 0) return emptyRows("Workflow definitions");
  return definitions.value.definitions.map((definition) => ({
    id: definition.name,
    cells: [
      { columnId: "name", value: definition.name, role: definition.enabled ? "success" : "muted" },
      { columnId: "state", value: definition.runtimeEnabled === false ? "runtime disabled" : definition.enabled ? "enabled" : "disabled", role: definition.enabled ? "success" : "warn" },
      { columnId: "detail", value: `${definition.stepCount} step(s); ${triggerSummary(definition)}`, role: "muted" },
    ],
  }));
}

export function activeRunRows(
  status: SurfaceRead<WorkflowStatusSnapshot>,
  abortAction?: UiAction,
): UiTableRow[] {
  if (!status.ok) return unavailableRows(status.message);
  if (status.value.activeRuns.length === 0) return emptyRows("Active runs");
  return status.value.activeRuns.map((run) => ({
    id: run.runId,
    cells: [
      { columnId: "name", value: shortId(run.runId), role: "info" },
      { columnId: "state", value: run.workflow, role: "success" },
      { columnId: "detail", value: `started ${run.startedAt}`, role: "muted" },
    ],
    ...(abortAction ? { action: abortAction } : {}),
  }));
}

export function queuedRunRows(
  status: SurfaceRead<WorkflowStatusSnapshot>,
  cancelAction?: UiAction,
): UiTableRow[] {
  if (!status.ok) return unavailableRows(status.message);
  if (status.value.pendingRuns.length === 0) return emptyRows("Queued runs");
  return status.value.pendingRuns.map((run, index) => ({
    id: run.runId ?? `queued-${index}`,
    cells: [
      { columnId: "name", value: shortId(run.runId ?? `queued-${index}`), role: "info" },
      { columnId: "state", value: run.workflowName, role: "warn" },
      { columnId: "detail", value: `enqueued ${new Date(run.enqueuedAtMs).toISOString()}; not-before ${new Date(run.notBeforeMs).toISOString()}`, role: "muted" },
    ],
    ...(cancelAction ? { action: cancelAction } : {}),
  }));
}

export function recentRunRows(
  runs: SurfaceRead<WorkflowRunsListResult>,
  actions: { retry: UiAction; replay: UiAction; resume: UiAction },
): UiTableRow[] {
  if (!runs.ok) return unavailableRows(runs.message);
  if (runs.value.runs.length === 0) return emptyRows("Recent runs");
  return runs.value.runs.map((run) => ({
    id: run.id,
    cells: [
      { columnId: "name", value: shortId(run.id), role: "info" },
      { columnId: "state", value: `${run.workflow} ${run.status}`, role: run.status === "failed" ? "error" : run.status === "success" ? "success" : "warn" },
      { columnId: "detail", value: `${run.startedAt}${run.usage?.cost.state === "complete" ? `  $${run.usage.cost.usd.toFixed(4)}` : run.usage === undefined ? "" : `  cost ${run.usage.cost.state}`}`, role: "muted" },
    ],
    action: run.status === "failed" || run.status === "interrupted"
      ? actions.retry
      : run.status === "success" || run.status === "completed-with-warnings"
        ? actions.replay
        : actions.resume,
  }));
}

export function approvalRows(approvals: SurfaceRead<{ approvals: PendingApproval[] }>): UiTableRow[] {
  if (!approvals.ok) return unavailableRows(approvals.message);
  if (approvals.value.approvals.length === 0) return emptyRows("Approvals");
  return approvals.value.approvals.map((approval) => ({
    id: approval.id,
    cells: [
      { columnId: "name", value: shortId(approval.id), role: approval.risk === "dangerous" ? "error" : "warn" },
      { columnId: "state", value: approval.status, role: approval.status === "pending" ? "warn" : "muted" },
      { columnId: "detail", value: `${approval.tool}  ${approval.reason}`, role: "muted" },
    ],
  }));
}

export function ownerQuestionRows(questions: SurfaceRead<{ questions: PendingOwnerQuestion[] }>): UiTableRow[] {
  if (!questions.ok) return unavailableRows(questions.message);
  if (questions.value.questions.length === 0) return emptyRows("Owner questions");
  return questions.value.questions.map((question) => ({
    id: question.id,
    cells: [
      { columnId: "name", value: shortId(question.id), role: "warn" },
      { columnId: "state", value: question.status, role: question.status === "pending" ? "warn" : "muted" },
      { columnId: "detail", value: question.question, role: "muted" },
    ],
  }));
}

export function runtimeLogEntries(args: {
  status: SurfaceRead<WorkflowStatusSnapshot>;
  runs: SurfaceRead<WorkflowRunsListResult>;
}): UiLogEntry[] {
  const entries: UiLogEntry[] = [];
  if (args.status.ok) {
    for (const run of args.status.value.activeRuns.slice(0, 3)) {
      entries.push({
        timestamp: run.startedAt,
        level: "info",
        source: `workflow.${run.workflow}`,
        message: `Active run ${run.runId} is executing.`,
      });
    }
  }
  if (args.runs.ok) {
    for (const run of args.runs.value.runs.slice(0, 3)) {
      entries.push({
        timestamp: run.startedAt,
        level: run.status === "failed" ? "error" : run.status === "success" ? "info" : "warn",
        source: `workflow.${run.workflow}`,
        message: `${run.id} ${run.status}.`,
      });
    }
  }
  return entries.length > 0 ? entries : [
    {
      timestamp: new Date().toISOString(),
      level: "info",
      source: "daemon.events",
      message: "Waiting for live workflow, approval, owner-question, and session events.",
    },
  ];
}

export function runAbortParameters(): UiActionParameterSpec {
  return runIdParameters("Run id");
}

export function runCancelParameters(): UiActionParameterSpec {
  return runIdParameters("Queued run id");
}

export function runRetryParameters(): UiActionParameterSpec {
  return runIdParameters("Failed run id");
}

export function runReplayParameters(): UiActionParameterSpec {
  return runIdParameters("Completed run id");
}

export function runResumeParameters(): UiActionParameterSpec {
  return {
    fields: [
      { id: "runId", label: "Failed run id", input: "text", required: true },
      { id: "fromStep", label: "Resume from step", input: "text", required: true },
    ],
    schema: {
      type: "object",
      required: ["runId", "fromStep"],
      properties: {
        runId: { type: "string" },
        fromStep: { type: "string" },
      },
      additionalProperties: false,
    },
  };
}

export function runCompareParameters(): UiActionParameterSpec {
  return {
    fields: [
      { id: "runIdA", label: "First run id", input: "text", required: true },
      { id: "runIdB", label: "Second run id", input: "text", required: true },
    ],
    schema: {
      type: "object",
      required: ["runIdA", "runIdB"],
      properties: {
        runIdA: { type: "string" },
        runIdB: { type: "string" },
      },
      additionalProperties: false,
    },
  };
}

export function runInspectParameters(): UiActionParameterSpec {
  return runIdParameters("Run id");
}

function runIdParameters(label: string): UiActionParameterSpec {
  return {
    fields: [{ id: "runId", label, input: "text", required: true }],
    schema: {
      type: "object",
      required: ["runId"],
      properties: { runId: { type: "string" } },
      additionalProperties: false,
    },
  };
}
