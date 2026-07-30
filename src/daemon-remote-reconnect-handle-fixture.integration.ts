import type {
  DaemonControlHandle,
  DaemonSseEvent,
  WorkflowLiveStatus,
  WorkflowRunDetail,
  WorkflowRunSummary,
} from "#core/daemon/daemon-control.js";
import { daemonSetupControlHandleStubs } from "#core/daemon/daemon-setup-control-test-stubs.js";
import type { EventBus } from "#core/events/event-bus.js";
import {
  REMOTE_RECONNECT_PROJECT_ID,
  REMOTE_RECONNECT_RUN_ID,
  REMOTE_RECONNECT_SESSION_ID,
  REMOTE_RECONNECT_STARTED_AT,
} from "./daemon-remote-reconnect-client-fixture.integration.js";

export function makeRemoteReconnectHandle(
  bus: EventBus,
  projectDir: string,
): DaemonControlHandle {
  const run: WorkflowRunDetail = {
    id: REMOTE_RECONNECT_RUN_ID,
    workflow: "builder",
    status: "running",
    triggerEvent: "remote.reconnect.test",
    triggerSchemaRef: null,
    startedAt: REMOTE_RECONNECT_STARTED_AT,
    tags: ["remote-reconnect"],
    steps: [{ id: "probe", type: "code", status: "success", durationMs: 2_000 }],
  };
  const summary: WorkflowRunSummary = {
    id: REMOTE_RECONNECT_RUN_ID,
    workflow: "builder",
    status: "running",
    triggerEvent: "remote.reconnect.test",
    triggerSchemaRef: null,
    startedAt: REMOTE_RECONNECT_STARTED_AT,
    tags: ["remote-reconnect"],
  };
  const workflowStatus: WorkflowLiveStatus = {
    activeRuns: [{
      runId: REMOTE_RECONNECT_RUN_ID,
      workflow: "builder",
      startedAt: REMOTE_RECONNECT_STARTED_AT,
    }],
    pendingRuns: [],
    queueLength: 0,
    completedRuns: 0,
    workflows: {
      builder: {
        lastStarted: {
          runId: REMOTE_RECONNECT_RUN_ID,
          startedAt: REMOTE_RECONNECT_STARTED_AT,
        },
      },
    },
    paused: false,
    agentConcurrency: 1,
    codeConcurrency: 4,
  };
  const sessions = [{
    id: REMOTE_RECONNECT_SESSION_ID,
    scopeId: REMOTE_RECONNECT_PROJECT_ID,
    projectId: REMOTE_RECONNECT_PROJECT_ID,
    createdAt: REMOTE_RECONNECT_STARTED_AT,
    lastActive: new Date(REMOTE_RECONNECT_STARTED_AT).getTime(),
    autonomyMode: "supervised" as const,
  }];

  return {
    getDaemonLiveState: () => ({
      startedAt: REMOTE_RECONNECT_STARTED_AT,
      pid: 1,
      running: true,
    }),
    getHealthStatus: () => ({ scheduler: "ok", modules: "ok" }),
    getWorkflowLiveStatus: () => workflowStatus,
    listChannelStatuses: () => [],
    pauseWorkflowDispatch: () => ({ already: false }),
    resumeWorkflowDispatch: () => ({ already: false }),
    abortActiveRuns: () => ({ aborted: 0 }),
    abortActiveRun: () => ({ ok: false, notFound: true }),
    reloadWorkflowDefinitions: () => ({ count: 1 }),
    reloadConfig: async () => ({
      workflows: 1,
      changedModules: [],
      sessionGuardrails: { refreshed: 0, unchanged: 0, nonRefreshable: [] },
    }),
    getWorkflowDefinitions: () => [],
    enableWorkflow: () => ({ ok: true }),
    disableWorkflow: () => ({ ok: true }),
    enqueuePendingRun: () => ({ ok: true, queued: "builder", runId: REMOTE_RECONNECT_RUN_ID }),
    cancelQueuedRun: () => ({ ok: false, active: true }),
    subscribeToEvents: (handler: (event: DaemonSseEvent) => void) => {
      const stops = [
        bus.on("workflow.started", (payload) => {
          handler({ type: "workflow.started", payload });
          handler({
            type: "queue.changed",
            payload: { source: "workflow.started", workflow: payload.workflow },
          });
        }),
        bus.on("workflow.step.completed", (payload) =>
          handler({ type: "workflow.step.completed", payload })),
        bus.on("approval.changed", (payload) => handler({ type: "approval.changed", payload })),
        bus.on("session.registered", (payload) => handler({ type: "session.registered", payload })),
        bus.on("owner.question.asked", (payload) =>
          handler({ type: "owner.question.asked", payload })),
        bus.on("owner.question.changed", (payload) =>
          handler({ type: "owner.question.changed", payload })),
        bus.on("owner.question.resolved", (payload) =>
          handler({ type: "owner.question.resolved", payload })),
      ];
      return () => stops.forEach((stop) => stop());
    },
    listWorkflowRuns: () => [summary],
    getWorkflowRun: (id: string) => id === REMOTE_RECONNECT_RUN_ID ? run : null,
    getWorkflowMetricCounts: () => ({
      runCounts: [],
      costTotals: [],
      durationHistogram: [],
      deadLetterCounts: { open: 0, dismissed: 0, redriven: 0 },
    }),
    probeCapabilityReadiness: async () => ({
      capabilities: [],
      summary: { ready: 0, unavailable: 0, init_failed: 0 },
    }),
    getClientIdentity: async () => ({
      projectName: "remote-reconnect",
      projectDir,
      projects: {
        defaultProjectId: REMOTE_RECONNECT_PROJECT_ID,
        projects: [{
          projectId: REMOTE_RECONNECT_PROJECT_ID,
          projectDir,
          displayName: "remote-reconnect",
        }],
      },
      daemonVersion: "0.1.0",
      pid: 1,
      startedAt: REMOTE_RECONNECT_STARTED_AT,
      dashboard: {
        available: false,
        reason: "not_contributed",
        message: "No module contributed a dashboard capability.",
      },
    }),
    getProjectRegistryProjection: () => ({
      defaultProjectId: REMOTE_RECONNECT_PROJECT_ID,
      projects: [{
        projectId: REMOTE_RECONNECT_PROJECT_ID,
        projectDir,
        displayName: "remote-reconnect",
      }],
    }),
    hasProject: (projectId: string) => projectId === REMOTE_RECONNECT_PROJECT_ID,
    getActiveProjectId: () => null,
    setActiveProjectId: (projectId) =>
      projectId === null || projectId === REMOTE_RECONNECT_PROJECT_ID
        ? { ok: true, activeProjectId: projectId }
        : { ok: false, reason: "not_found", projectId },
    registerSession: () => undefined,
    unregisterSession: () => undefined,
    listSessions: () => sessions,
    setSessionAutonomyMode: () => ({ ok: true }),
    ...daemonSetupControlHandleStubs(),
  };
}
