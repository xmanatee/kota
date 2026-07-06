import type { PendingApproval } from "#core/daemon/approval-queue.js";
import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import type {
  WorkflowDefinitionsResult,
  WorkflowRunsListResult,
  WorkflowStatusSnapshot,
} from "#modules/workflow-ops/client.js";
import type { SessionsListResult } from "./client.js";
import {
  action,
  NAME_STATE_DETAIL_COLUMNS,
  readRole,
  readValue,
  resultSpec,
  type SurfaceRead,
  scopeIdForStatus,
  uniqueActions,
} from "./operator-ui-builder-common.js";
import {
  launchDefaultParameters,
  launchWorkflowParameters,
  sessionLaunchParameters,
} from "./operator-ui-launch-controls.js";
import { runtimeRunActions } from "./operator-ui-runtime-actions.js";
import {
  activeRunRows,
  approvalRows,
  ownerQuestionRows,
  queuedRunRows,
  recentRunRows,
  runtimeLogEntries,
  workflowRows,
} from "./operator-ui-runtime-helpers.js";
import type { UiSurface } from "./operator-ui-types.js";
import type { StatusSnapshot } from "./status-cli.js";

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
  const runActions = runtimeRunActions(scopeId);
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
    ...runActions.all,
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
      { kind: "table", title: "Active run supervision", columns: NAME_STATE_DETAIL_COLUMNS, rows: activeRunRows(args.workflowStatus, runActions.abortOneRun) },
      { kind: "table", title: "Queued workflow runs", columns: NAME_STATE_DETAIL_COLUMNS, rows: queuedRunRows(args.workflowStatus, runActions.cancelQueuedRun) },
      { kind: "table", title: "Recent run results", columns: NAME_STATE_DETAIL_COLUMNS, rows: recentRunRows(args.runs, { retry: runActions.retryRun, replay: runActions.replayRun, resume: runActions.resumeRun }) },
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
