import type { ChannelStatus } from "#core/channels/channel.js";
import type { BusEvents } from "#core/events/event-bus-types.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { ToolCallSummaryEntry, WorkflowActiveRun, WorkflowQueuedRun, WorkflowRuntimeState, WorkflowStepSkipReason } from "#core/workflow/run-types.js";
import type { WorkflowAgentBackoffState } from "#core/workflow/trigger-types.js";
import type { CapabilityReadinessResponse } from "./capability-readiness.js";
import type { ClientIdentity } from "./client-identity.js";
import type { DaemonState } from "./daemon-state.js";
import type { ProjectId, ProjectRegistryProjection } from "./project-registry.js";

/**
 * Typed wire-shape for the daemon's "unknown projectId" rejection on a
 * project-scoped route. Built by `daemon-control-utils` when the route
 * validates `?projectId=` and the id does not match a configured project.
 */
export type UnknownProjectError = {
  error: "Unknown project";
  reason: "unknown_project";
  projectId: string;
};

/**
 * Result of {@link DaemonControlHandle.setActiveProjectId}. The success
 * arm carries the new active selection (echoing the requested value back
 * so callers don't need a follow-up read); the rejection arm names the
 * unknown id so route handlers can 404 with the typed shape.
 */
export type SetActiveProjectResult =
  | { ok: true; activeProjectId: ProjectId | null }
  | { ok: false; reason: "not_found"; projectId: string };

export type { ChannelStatus };

export type WorkflowDefinitionTriggerSummary =
  | { type: "event"; event: string; filter?: Record<string, string | string[]> }
  | { type: "cron"; schedule: string }
  | { type: "interval"; intervalMs: number }
  | { type: "webhook" }
  | { type: "watch"; patterns: string[]; debounceMs: number };

export type WorkflowDefinitionSummary = {
  name: string;
  enabled: boolean;
  /** Present only when a runtime override differs from the static source `enabled` value. */
  runtimeEnabled?: boolean;
  stepCount: number;
  triggers: WorkflowDefinitionTriggerSummary[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
};

export type DaemonControlAddress = {
  port: number;
  pid: number;
  startedAt: string;
  token: string;
};

/**
 * Capability scopes for daemon control access.
 * - read: observe daemon and workflow state, subscribe to events
 * - control: mutate workflow dispatch (pause/resume/abort/reload/trigger)
 */
export type CapabilityScope = "read" | "control";

export type WorkflowLiveStatus = {
  activeRuns: WorkflowActiveRun[];
  pendingRuns: WorkflowQueuedRun[];
  queueLength: number;
  completedRuns: number;
  totalCostUsd?: number;
  agentBackoff?: WorkflowAgentBackoffState;
  definitionsLoadedAt?: string;
  workflows: WorkflowRuntimeState["workflows"];
  paused: boolean;
  /** True when a dispatchWindow is configured and the current time is outside it. */
  dispatchWindowBlocked?: boolean;
  /** ISO timestamp of the next time the dispatch window opens (when blocked). */
  dispatchWindowOpensAt?: string;
  /** Active agent workflow concurrency limit (from scheduler.agentConcurrency or default 1). */
  agentConcurrency: number;
  /** Active code workflow concurrency limit (from scheduler.codeConcurrency or default 4). */
  codeConcurrency: number;
};

export type DaemonLiveStatus = DaemonState & {
  running: boolean;
  workflow: WorkflowLiveStatus;
  sessions: InteractiveSession[];
  channels: ChannelStatus[];
};

/**
 * Payload for the SSE-only `queue.changed` event. Synthesized at the daemon
 * handle from the upstream `workflow.started` / `workflow.completed` bus
 * events; subscribers use it to invalidate operator-facing queue views
 * without re-reading the workflow runtime state.
 */
export type QueueChangedPayload =
  | { source: "workflow.started"; workflow: string }
  | {
      source: "workflow.completed";
      workflow: string;
      status: BusEvents["workflow.completed"]["status"];
    };

/**
 * Daemon SSE broadcast events. Each variant carries the typed bus payload
 * its name implies; consumers narrow on `type` and access `payload` fields
 * directly without re-validation.
 */
export type DaemonSseEvent =
  | { type: "workflow.started"; payload: BusEvents["workflow.started"] }
  | { type: "workflow.completed"; payload: BusEvents["workflow.completed"] }
  | { type: "workflow.step.completed"; payload: BusEvents["workflow.step.completed"] }
  | { type: "queue.changed"; payload: QueueChangedPayload }
  | { type: "approval.changed"; payload: BusEvents["approval.changed"] }
  | { type: "task.changed"; payload: BusEvents["task.changed"] }
  | { type: "session.registered"; payload: BusEvents["session.registered"] }
  | { type: "session.unregistered"; payload: BusEvents["session.unregistered"] }
  | { type: "owner.question.asked"; payload: BusEvents["owner.question.asked"] }
  | { type: "owner.question.changed"; payload: BusEvents["owner.question.changed"] }
  | { type: "owner.question.resolved"; payload: BusEvents["owner.question.resolved"] }
  | { type: "owner.question.dismissed"; payload: BusEvents["owner.question.dismissed"] }
  | { type: "owner.question.expired"; payload: BusEvents["owner.question.expired"] };

export type DaemonSseEventType = DaemonSseEvent["type"];

export type DaemonSseStreamEvent = DaemonSseEvent & {
  /** Opaque, daemon-local event id. Clients use it as the reconnect cursor. */
  id: string;
};

export type DaemonTimelineEvent = DaemonSseStreamEvent & {
  /** ISO timestamp for human-facing timeline ordering and timestamp catch-up. */
  timestamp: string;
};

export type WorkflowRunSummary = {
  id: string;
  workflow: string;
  status: string;
  triggerEvent: string;
  startedAt: string;
  durationMs?: number;
  totalCostUsd?: number;
  triggeredByRunId?: string;
  causedBy?: { runId: string; workflow: string };
  retryOf?: string;
  resumedFromRunId?: string;
  tags?: string[];
};

export type WorkflowRunStepSummary = {
  id: string;
  type: string;
  status: string;
  durationMs: number;
  error?: string;
  costUsd?: number;
  toolCalls?: ToolCallSummaryEntry[];
  skipReason?: WorkflowStepSkipReason;
};

export type WorkflowRunDetail = WorkflowRunSummary & {
  completedAt?: string;
  triggerPayload?: Record<string, unknown>;
  steps: WorkflowRunStepSummary[];
  warnings?: Array<{ type: string; message: string }>;
};

export type InteractiveSession = {
  id: string;
  createdAt: string;
  lastActive: number;
  /** Operator supervision mode the session runs under. */
  autonomyMode: AutonomyMode;
  /** "serve" = registered from kota serve; "daemon" = owned by daemon control API. */
  source?: "daemon" | "serve";
};

export type WorkflowRunCountEntry = {
  workflow: string;
  status: string;
  count: number;
};

export type WorkflowCostEntry = {
  workflow: string;
  costUsd: number;
};

export type WorkflowDurationHistogramEntry = {
  workflow: string;
  status: string;
  /** Bucket counts indexed by upper bound in seconds; "+Inf" always present */
  buckets: Array<{ le: number | "+Inf"; count: number }>;
  sum: number;
  count: number;
};

export type WorkflowMetricCounts = {
  runCounts: WorkflowRunCountEntry[];
  costTotals: WorkflowCostEntry[];
  durationHistogram: WorkflowDurationHistogramEntry[];
};

export type ComponentStatus = "ok" | "error";

export type ModuleHealthCheckResult = {
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
};

export type HealthStatus = {
  scheduler: ComponentStatus;
  modules: ComponentStatus;
  moduleHealthChecks?: Record<string, ModuleHealthCheckResult>;
};

export type DaemonControlHandle = {
  getDaemonLiveState(): DaemonState & { running: boolean };
  getHealthStatus(): HealthStatus;
  /**
   * Live status for a single project's workflow runtime. `projectId` is
   * optional; when omitted the daemon resolves the registry's default
   * project. The caller is responsible for validating the id beforehand
   * via {@link DaemonControlHandle.hasProject} — handle methods that
   * receive an unknown id throw, since route handlers translate the typed
   * "unknown_project" rejection to a 404 *before* dispatching.
   */
  getWorkflowLiveStatus(projectId?: ProjectId): WorkflowLiveStatus;
  /** Snapshot of every contributed channel's startup posture. */
  listChannelStatuses(): ChannelStatus[];
  /** Typed projection of the daemon's configured project registry. */
  getProjectRegistryProjection(): ProjectRegistryProjection;
  /**
   * True when `projectId` matches a configured project. Route handlers
   * call this before invoking a project-scoped handle method so they can
   * 404 with the unknown id surfaced explicitly to the caller.
   */
  hasProject(projectId: string): boolean;
  /**
   * Operator-selected active project id, or `null` when no explicit
   * selection is in force (the daemon falls back to the registry default).
   * The selection is in-memory daemon state — restarting the daemon clears
   * it. Routes that resolve `?projectId=` consult this when the query
   * parameter is absent so a `kota project use` selection scopes every
   * subsequent CLI call without each command re-passing `--project`.
   */
  getActiveProjectId(): ProjectId | null;
  /**
   * Update the operator-selected active project id. `null` clears the
   * selection (routes fall back to the registry default). Unknown ids
   * surface `{ ok: false, reason: "not_found" }`; route handlers translate
   * that to a 404 wire response.
   */
  setActiveProjectId(projectId: ProjectId | null): SetActiveProjectResult;
  pauseWorkflowDispatch(projectId?: ProjectId): { already: boolean };
  resumeWorkflowDispatch(projectId?: ProjectId): { already: boolean };
  abortActiveRuns(projectId?: ProjectId): { aborted: number };
  abortActiveRun(runId: string, projectId?: ProjectId): { ok: boolean; notFound?: boolean; queued?: boolean };
  reloadWorkflowDefinitions(projectId?: ProjectId): { count: number };
  reloadConfig(): Promise<{ workflows: number; changedModules: string[] }>;
  getWorkflowDefinitions(projectId?: ProjectId): WorkflowDefinitionSummary[];
  enableWorkflow(name: string, projectId?: ProjectId): { ok: boolean; notFound?: boolean };
  disableWorkflow(name: string, projectId?: ProjectId): { ok: boolean; notFound?: boolean };
  enqueuePendingRun(name: string, tags?: string[], extraPayload?: Record<string, unknown>, projectId?: ProjectId): { ok: boolean; queued?: string; runId?: string; alreadyQueued?: boolean; error?: string };
  cancelQueuedRun(runId: string, projectId?: ProjectId): { ok: boolean; notFound?: boolean; active?: boolean };
  subscribeToEvents(handler: (event: DaemonSseEvent) => void): () => void;
  // Workflow runs
  listWorkflowRuns(opts?: { workflow?: string; limit?: number; tag?: string; causedByRunId?: string; projectId?: ProjectId }): WorkflowRunSummary[];
  getWorkflowRun(id: string, projectId?: ProjectId): WorkflowRunDetail | null;
  // Metrics
  getWorkflowMetricCounts(projectId?: ProjectId): WorkflowMetricCounts;
  // Capability readiness
  probeCapabilityReadiness(): Promise<CapabilityReadinessResponse>;
  // Thin-client identity (project + dashboard availability)
  getClientIdentity(): Promise<ClientIdentity>;
  // Interactive sessions
  registerSession(id: string, createdAt: string, autonomyMode: AutonomyMode): void;
  unregisterSession(id: string): void;
  listSessions(projectId?: ProjectId): InteractiveSession[];
  /**
   * Change a registered session's autonomy mode. Returns `{ ok: true }` when
   * the daemon owns an `AgentSession` it can mutate, or when it is able to
   * propagate the update to a serve-registered session.
   *
   * For serve-registered sessions the daemon only holds advisory metadata; it
   * updates that metadata immediately and returns `serveOwned: true` so the
   * caller knows the authoritative change must reach the owning serve process
   * (which re-registers the session on its own PATCH path).
   */
  setSessionAutonomyMode(id: string, mode: AutonomyMode): {
    ok: boolean;
    notFound?: boolean;
    serveOwned?: boolean;
  };
};
