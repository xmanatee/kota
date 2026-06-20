import type { PendingApproval } from "#core/daemon/approval-queue.js";
import type { WorkflowDefinitionSummary } from "#core/daemon/daemon-control.js";
import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import type {
  WorkflowDefinitionsResult,
  WorkflowRunsListResult,
  WorkflowStatusSnapshot,
} from "#modules/workflow-ops/client.js";
import type { SessionsListResult } from "./client.js";
import {
  action,
  emptyRows,
  NAME_STATE_DETAIL_COLUMNS,
  readRole,
  readValue,
  resultSpec,
  type SurfaceRead,
  scopeIdForStatus,
  shortId,
  unavailableRows,
  uniqueActions,
} from "./operator-ui-builder-common.js";
import {
  launchDefaultParameters,
  launchWorkflowParameters,
  sessionLaunchParameters,
} from "./operator-ui-launch-controls.js";
import type {
  UiActionParameterSpec,
  UiLogEntry,
  UiSurface,
  UiTableRow,
} from "./operator-ui-types.js";
import type { StatusSnapshot } from "./status-cli.js";

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

function workflowRows(definitions: SurfaceRead<WorkflowDefinitionsResult>): UiTableRow[] {
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

function activeRunRows(status: SurfaceRead<WorkflowStatusSnapshot>): UiTableRow[] {
  if (!status.ok) return unavailableRows(status.message);
  if (status.value.activeRuns.length === 0) return emptyRows("Active runs");
  return status.value.activeRuns.map((run) => ({
    id: run.runId,
    cells: [
      { columnId: "name", value: shortId(run.runId), role: "info" },
      { columnId: "state", value: run.workflow, role: "success" },
      { columnId: "detail", value: `started ${run.startedAt}`, role: "muted" },
    ],
  }));
}

function queuedRunRows(status: SurfaceRead<WorkflowStatusSnapshot>): UiTableRow[] {
  if (!status.ok) return unavailableRows(status.message);
  if (status.value.pendingRuns.length === 0) return emptyRows("Queued runs");
  return status.value.pendingRuns.map((run, index) => ({
    id: run.runId ?? `queued-${index}`,
    cells: [
      { columnId: "name", value: shortId(run.runId ?? `queued-${index}`), role: "info" },
      { columnId: "state", value: run.workflowName, role: "warn" },
      { columnId: "detail", value: `enqueued ${new Date(run.enqueuedAtMs).toISOString()}; not-before ${new Date(run.notBeforeMs).toISOString()}`, role: "muted" },
    ],
  }));
}

function recentRunRows(runs: SurfaceRead<WorkflowRunsListResult>): UiTableRow[] {
  if (!runs.ok) return unavailableRows(runs.message);
  if (runs.value.runs.length === 0) return emptyRows("Recent runs");
  return runs.value.runs.map((run) => ({
    id: run.id,
    cells: [
      { columnId: "name", value: shortId(run.id), role: "info" },
      { columnId: "state", value: `${run.workflow} ${run.status}`, role: run.status === "failed" ? "error" : run.status === "success" ? "success" : "warn" },
      { columnId: "detail", value: `${run.startedAt}${run.totalCostUsd !== undefined ? `  $${run.totalCostUsd.toFixed(4)}` : ""}`, role: "muted" },
    ],
  }));
}

function approvalRows(approvals: SurfaceRead<{ approvals: PendingApproval[] }>): UiTableRow[] {
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

function ownerQuestionRows(questions: SurfaceRead<{ questions: PendingOwnerQuestion[] }>): UiTableRow[] {
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

function runtimeLogEntries(args: {
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

function runAbortParameters(): UiActionParameterSpec {
  return {
    fields: [{ id: "runId", label: "Run id", input: "text", required: true }],
    schema: {
      type: "object",
      required: ["runId"],
      properties: { runId: { type: "string" } },
      additionalProperties: false,
    },
  };
}

export function buildRuntimeUiSurface(args: {
  status: StatusSnapshot;
  workflowStatus: SurfaceRead<WorkflowStatusSnapshot>;
  runs: SurfaceRead<WorkflowRunsListResult>;
  definitions: SurfaceRead<WorkflowDefinitionsResult>;
  approvals: SurfaceRead<{ approvals: PendingApproval[] }>;
  ownerQuestions: SurfaceRead<{ questions: PendingOwnerQuestion[] }>;
  sessions: SurfaceRead<SessionsListResult>;
}): UiSurface {
  const scopeId = scopeIdForStatus(args.status);
  const launch = action({
    surfaceId: "runs",
    actionId: "workflow.launch",
    scopeId,
    label: "Launch workflow run",
    effect: "write",
    operation: { kind: "daemon-route", method: "POST", path: "/workflow/trigger" },
    parameters: launchWorkflowParameters(),
    confirmation: {
      mode: "required",
      title: "Launch workflow",
      detail: "This queues a workflow run in the selected scope.",
      confirmLabel: "Launch run",
      risk: "medium",
    },
    result: resultSpec("Workflow queued."),
  });
  const actions = [
    action({
      surfaceId: "runs",
      actionId: "workflow.status",
      scopeId,
      label: "Refresh workflow status",
      operation: { kind: "client-namespace", namespace: "workflow", method: "status" },
      result: resultSpec("Workflow status loaded."),
    }),
    action({
      surfaceId: "runs",
      actionId: "workflow.pause",
      scopeId,
      label: "Pause dispatch",
      effect: "write",
      operation: { kind: "client-namespace", namespace: "workflow", method: "pause" },
      confirmation: {
        mode: "required",
        title: "Pause workflow dispatch",
        detail: "No new workflow runs will be dispatched until resumed.",
        confirmLabel: "Pause dispatch",
        risk: "medium",
      },
      result: resultSpec("Workflow dispatch paused."),
    }),
    action({
      surfaceId: "runs",
      actionId: "workflow.resume",
      scopeId,
      label: "Resume dispatch",
      effect: "write",
      operation: { kind: "client-namespace", namespace: "workflow", method: "resume" },
      result: resultSpec("Workflow dispatch resumed."),
    }),
    action({
      surfaceId: "runs",
      actionId: "workflow.abort",
      scopeId,
      label: "Abort active runs",
      effect: "write",
      operation: { kind: "client-namespace", namespace: "workflow", method: "abort" },
      confirmation: {
        mode: "required",
        title: "Abort active workflow runs",
        detail: "This asks every active workflow run to stop.",
        confirmLabel: "Abort runs",
        risk: "high",
      },
      result: resultSpec("Active workflow runs aborted."),
    }),
    action({
      surfaceId: "runs",
      actionId: "run.abort",
      scopeId,
      label: "Abort one run",
      effect: "write",
      operation: { kind: "client-namespace", namespace: "workflow", method: "abortRun" },
      parameters: runAbortParameters(),
      confirmation: {
        mode: "required",
        title: "Abort workflow run",
        detail: "This asks one active workflow run to stop.",
        confirmLabel: "Abort run",
        risk: "high",
      },
      result: resultSpec("Workflow run aborted."),
    }),
    launch,
  ];

  const activeCount = args.workflowStatus.ok ? args.workflowStatus.value.activeRuns.length : 0;
  const queuedCount = args.workflowStatus.ok ? args.workflowStatus.value.pendingRuns.length : 0;
  const agentLimit = args.workflowStatus.ok ? args.workflowStatus.value.agentConcurrency : 1;
  const codeLimit = args.workflowStatus.ok ? args.workflowStatus.value.codeConcurrency : 1;

  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "runs",
    extensionId: "core.runs",
    title: "Runs and Automations",
    intent: "Work",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Work" },
    order: 30,
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [
      {
        kind: "status-summary",
        entries: [
          { label: "Dispatch", value: args.workflowStatus.ok ? args.workflowStatus.value.paused ? "paused" : "running" : args.workflowStatus.message, role: readRole(args.workflowStatus) },
          { label: "Active", value: `${activeCount}`, role: activeCount > 0 ? "warn" : "muted" },
          { label: "Queued", value: `${queuedCount}`, role: queuedCount > 0 ? "warn" : "muted" },
          { label: "Definitions", value: readValue(args.definitions, (definitions) => `${definitions.definitions.length}`), role: readRole(args.definitions) },
          { label: "Approvals", value: readValue(args.approvals, (approvals) => `${approvals.approvals.length}`), role: readRole(args.approvals) },
          { label: "Owner questions", value: readValue(args.ownerQuestions, (questions) => `${questions.questions.length}`), role: readRole(args.ownerQuestions) },
          { label: "Sessions", value: readValue(args.sessions, (sessions) => `${sessions.sessions.length}`), role: readRole(args.sessions) },
        ],
      },
      { kind: "progress", label: "Agent run slots", value: Math.min(activeCount, agentLimit), max: Math.max(1, agentLimit), role: activeCount > 0 ? "warn" : "info" },
      { kind: "progress", label: "Code run slots", value: Math.min(activeCount, codeLimit), max: Math.max(1, codeLimit), role: activeCount > 0 ? "warn" : "info" },
      { kind: "table", title: "Active run supervision", columns: NAME_STATE_DETAIL_COLUMNS, rows: activeRunRows(args.workflowStatus) },
      { kind: "table", title: "Queued workflow runs", columns: NAME_STATE_DETAIL_COLUMNS, rows: queuedRunRows(args.workflowStatus) },
      { kind: "table", title: "Recent run results", columns: NAME_STATE_DETAIL_COLUMNS, rows: recentRunRows(args.runs) },
      { kind: "table", title: "Workflow definitions and schedules", columns: NAME_STATE_DETAIL_COLUMNS, rows: workflowRows(args.definitions) },
      { kind: "table", title: "Approvals", columns: NAME_STATE_DETAIL_COLUMNS, rows: approvalRows(args.approvals) },
      { kind: "table", title: "Owner questions", columns: NAME_STATE_DETAIL_COLUMNS, rows: ownerQuestionRows(args.ownerQuestions) },
      {
        kind: "log-stream",
        title: "Live run event stream",
        streamId: "workflow-events",
        source: {
          kind: "sse",
          path: "/events",
          eventTypes: [
            "workflow.started",
            "workflow.step.completed",
            "workflow.completed",
            "queue.changed",
            "approval.changed",
            "owner.question.asked",
            "owner.question.changed",
            "session.registered",
            "session.unregistered",
          ],
        },
        entries: runtimeLogEntries({ status: args.workflowStatus, runs: args.runs }),
      },
      {
        kind: "form",
        title: "Launch workflow run",
        fields: launchWorkflowParameters().fields,
        submit: launch,
      },
      {
        kind: "form",
        title: "Run/session parameters",
        fields: sessionLaunchParameters().fields,
        submit: action({
          surfaceId: "runs",
          actionId: "session.launch",
          scopeId,
          label: "Start session",
          effect: "write",
          operation: { kind: "daemon-route", method: "POST", path: "/sessions" },
          parameters: sessionLaunchParameters(),
          result: resultSpec("Session started."),
        }),
      },
      {
        kind: "form",
        title: "Model, effort, and launch defaults",
        fields: launchDefaultParameters().fields,
        submit: action({
          surfaceId: "runs",
          actionId: "launch.defaults.configure",
          scopeId,
          label: "Configure launch defaults",
          effect: "write",
          operation: { kind: "client-namespace", namespace: "config", method: "set" },
          parameters: launchDefaultParameters(),
          readiness: {
            state: "disabled",
            reason: "controller-unavailable",
            message: "The shared UI exposes preset/model/effort defaults; a multi-key config controller is not installed yet.",
          },
          result: resultSpec("Launch defaults updated."),
        }),
      },
      { kind: "action-list", title: "Run controls", actions },
    ],
    actions: uniqueActions(actions),
  };
}
