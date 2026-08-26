import type { PendingApproval } from "#core/daemon/approval-queue.js";
import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import type { UiStatusEntry, UiSurface } from "#core/daemon/ui-surface.js";
import {
  action,
  NAME_STATE_DETAIL_COLUMNS,
  readRole,
  readValue,
  resultSpec,
  type SurfaceRead,
  uniqueActions,
} from "#core/daemon/ui-surface-builders.js";
import type { SessionsListResult } from "#modules/daemon-ops/client.js";
import {
  launchDefaultParameters,
  launchWorkflowParameters,
  sessionLaunchParameters,
} from "#modules/daemon-ops/operator-ui-launch-controls.js";
import type {
  WorkflowDefinitionsResult,
  WorkflowRunsListResult,
  WorkflowStatusSnapshot,
} from "#modules/workflow-ops/client.js";
import { runtimeRunActions } from "./ui-runtime-actions.js";
import {
  activeRunRows,
  approvalRows,
  ownerQuestionRows,
  queuedRunRows,
  recentRunRows,
  runtimeLogEntries,
  workflowRows,
} from "./ui-runtime-helpers.js";

function dispatchSummary(
  workflowStatus: SurfaceRead<WorkflowStatusSnapshot>,
): UiStatusEntry {
  if (!workflowStatus.ok) {
    return {
      label: "Dispatch",
      value: workflowStatus.message,
      role: readRole(workflowStatus),
    };
  }
  const pause = workflowStatus.value.pause;
  if (pause?.kind === "operator") {
    return { label: "Dispatch", value: "paused by operator", role: "warn" };
  }
  return {
    label: "Dispatch",
    value: workflowStatus.value.paused ? "paused" : "running",
    role: workflowStatus.value.paused ? "warn" : "success",
  };
}

export function buildRuntimeUiSurface(args: {
  scopeId: string;
  workflowStatus: SurfaceRead<WorkflowStatusSnapshot>;
  runs: SurfaceRead<WorkflowRunsListResult>;
  definitions: SurfaceRead<WorkflowDefinitionsResult>;
  approvals: SurfaceRead<{ approvals: PendingApproval[] }>;
  ownerQuestions: SurfaceRead<{ questions: PendingOwnerQuestion[] }>;
  sessions: SurfaceRead<SessionsListResult>;
}): UiSurface {
  const { scopeId } = args;
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
  const sessionLaunch = action({
    surfaceId: "runs",
    actionId: "session.launch",
    scopeId,
    label: "Start session",
    effect: "write",
    operation: { kind: "daemon-route", method: "POST", path: "/sessions" },
    parameters: sessionLaunchParameters(),
    result: resultSpec("Session started."),
  });
  const launchDefaults = action({
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
    ...runActions.all,
    sessionLaunch,
    launchDefaults,
    launch,
  ];

  const activeCount = args.workflowStatus.ok ? args.workflowStatus.value.activeRuns.length : 0;
  const queuedCount = args.workflowStatus.ok ? args.workflowStatus.value.pendingRuns.length : 0;
  const concurrency = args.workflowStatus.ok ? args.workflowStatus.value.concurrency : 1;

  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "runs",
    extensionId: "core.runs",
    title: "Runs and Automations",
    intent: "Work",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Work" },
    order: 30,
    refreshEvents: [
      "workflow.started",
      "workflow.step.completed",
      "workflow.completed",
      "queue.changed",
      "approval.changed",
      "owner.question.asked",
      "owner.question.changed",
      "owner.question.resolved",
      "owner.question.dismissed",
      "owner.question.expired",
      "session.registered",
      "session.unregistered",
    ],
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [
      {
        kind: "status-summary",
        entries: [
          dispatchSummary(args.workflowStatus),
          { label: "Active", value: `${activeCount}`, role: activeCount > 0 ? "warn" : "muted" },
          { label: "Queued", value: `${queuedCount}`, role: queuedCount > 0 ? "warn" : "muted" },
          { label: "Definitions", value: readValue(args.definitions, (definitions) => `${definitions.definitions.length}`), role: readRole(args.definitions) },
          { label: "Approvals", value: readValue(args.approvals, (approvals) => `${approvals.approvals.length}`), role: readRole(args.approvals) },
          { label: "Owner questions", value: readValue(args.ownerQuestions, (questions) => `${questions.questions.length}`), role: readRole(args.ownerQuestions) },
          { label: "Sessions", value: readValue(args.sessions, (sessions) => `${sessions.sessions.length}`), role: readRole(args.sessions) },
        ],
      },
      { kind: "progress", label: "Run slots", value: Math.min(activeCount, concurrency), max: Math.max(1, concurrency), role: activeCount > 0 ? "warn" : "info" },
      { kind: "table", title: "Active run supervision", columns: NAME_STATE_DETAIL_COLUMNS, rows: activeRunRows(args.workflowStatus, runActions.abortOneRun) },
      { kind: "table", title: "Queued workflow runs", columns: NAME_STATE_DETAIL_COLUMNS, rows: queuedRunRows(args.workflowStatus, runActions.cancelQueuedRun) },
      { kind: "table", title: "Recent run results", columns: NAME_STATE_DETAIL_COLUMNS, rows: recentRunRows(args.runs, { retry: runActions.retryRun, replay: runActions.replayRun, resume: runActions.resumeRun }) },
      { kind: "table", title: "Workflow definitions and schedules", columns: NAME_STATE_DETAIL_COLUMNS, rows: workflowRows(args.definitions) },
      { kind: "table", title: "Approvals", columns: NAME_STATE_DETAIL_COLUMNS, rows: approvalRows(args.approvals) },
      { kind: "table", title: "Owner questions", columns: NAME_STATE_DETAIL_COLUMNS, rows: ownerQuestionRows(args.ownerQuestions) },
      {
        kind: "form",
        title: "Inspect one run",
        fields: runActions.inspectRun.parameters!.fields,
        submit: runActions.inspectRun,
      },
      {
        kind: "form",
        title: "Compare two runs",
        fields: runActions.compareRuns.parameters!.fields,
        submit: runActions.compareRuns,
      },
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
        submit: sessionLaunch,
      },
      {
        kind: "form",
        title: "Model, effort, and launch defaults",
        fields: launchDefaultParameters().fields,
        submit: launchDefaults,
      },
      { kind: "action-list", title: "Run controls", actions },
    ],
    actions: uniqueActions(actions),
  };
}
