import type { ChannelUserIdentity } from "#core/channels/channel.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { WorkflowStepSkipReason } from "#core/workflow/run-types.js";
import type { DaemonConfigReloadEvent, ScopeLifecycleEvent } from "./event-bus-lifecycle-types.js";
import type { EventPayloadRecord } from "./event-bus-types.js";
import type { ScopeId } from "./scope.js";

type QueueCounts = {
  backlog: number;
  ready: number;
  doing: number;
  blocked: number;
  done: number;
  dropped: number;
};

type QueueDependencyBlockedTask = {
  id: string;
  title: string;
  state: "backlog" | "ready" | "doing";
  dependsOn: string[];
  waitingOn: string[];
};

export type AutonomyQueueAvailableEvent = Readonly<{
  scopeId: ScopeId;
  taskId: string;
  taskPath: string;
  taskState: "ready" | "doing";
  taskUpdatedAt: string;
  taskDigest: string;
  title: string;
  priority: string;
  taskClass: "Product" | "Safety" | "Platform" | "Meta" | "Unclassified";
  dependsOn: readonly string[];
  idempotencyKey: string;
}>;

/**
 * Known event payloads. Extend this map to add new typed events.
 *
 * Directory-scope event payloads carry one required `scopeId`. Emitters that
 * route through `ScopedEventBus` receive that identity at runtime so workflow
 * filters and clients share the same scope contract.
 *
 * Daemon-wide events (module loader, model provider failover) intentionally
 * omit scope attribution. Tool-call-level guardrail events stay session-bound
 * rather than directory-scope attributed.
 */
export type RuntimeBusEvents = {
  "runtime.idle": {
    scopeId: ScopeId;
    timestamp: string;
    idleIntervalMs: number;
  };
  "runtime.restart_requested": {
    scopeId: ScopeId;
    reason?: string;
    workflow?: string;
    runId?: string;
    requires?: string[];
  };
  "daemon.config.reload": DaemonConfigReloadEvent;
  "scope.lifecycle.changed": ScopeLifecycleEvent;
  "autonomy.queue.available": AutonomyQueueAvailableEvent;
  "autonomy.inbox.available": {
    scopeId: ScopeId;
    inboxCount: number;
  };
  "autonomy.queue.needs-promotion": {
    scopeId: ScopeId;
    backlogCount: number;
    promotableBacklogCount: number;
    dispatchableCount?: number;
    counts: QueueCounts;
    dependencyBlockedTasks: QueueDependencyBlockedTask[];
  };
  "autonomy.queue.empty": {
    scopeId: ScopeId;
    counts: QueueCounts;
    dependencyBlockedTasks: QueueDependencyBlockedTask[];
  };
  "autonomy.blocked-research.attemptable": {
    scopeId: ScopeId;
    candidateCount: number;
    attemptableCount: number;
    counts: QueueCounts;
  };
  "autonomy.queue.thin": {
    scopeId: ScopeId;
    pullableCount: number;
    promotableBacklogCount: number;
    dispatchableCount?: number;
    counts: QueueCounts;
    dependencyBlockedTasks: QueueDependencyBlockedTask[];
  };
  "workflow.started": {
    scopeId: ScopeId;
    workflow: string;
    runId: string;
    triggerEvent: string;
    definitionPath: string;
    runDir: string;
    startedAt: string;
    /**
     * Workflow-level autonomy posture, taken from the definition's
     * `defaultAutonomyMode`. Absent when the workflow does not declare one.
     * Subscribers (tracing, metrics) use this to tag run-level spans and
     * metrics so operator dashboards can slice by supervision posture.
     */
    autonomyMode?: AutonomyMode;
  };
  "workflow.completed": {
    scopeId: ScopeId;
    workflow: string;
    runId: string;
    status: "success" | "failed" | "interrupted" | "completed-with-warnings";
    triggerEvent: string;
    durationMs: number;
    definitionPath: string;
    runDir: string;
    tags: readonly string[];
    /**
     * Present when the run failed with a classified agent-dispatch failure
     * (rate_limit, auth, provider, runtime). Populated from the same classifier that
     * drives agent-dispatch backoff so subscribers — tracing, metrics — can
     * observe the failure class without parsing error strings.
     */
    failureKind?: "rate_limit" | "auth" | "provider" | "runtime";
    /** Workflow-level autonomy posture. See {@link workflow.started}. */
    autonomyMode?: AutonomyMode;
    /** Stable durable identity when completion follows repository publication. */
    publicationId?: string;
  };
  "workflow.step.started": {
    scopeId: ScopeId;
    workflow: string;
    runId: string;
    stepId: string;
    stepType: "tool" | "agent" | "emit" | "restart" | "code" | "parallel" | "trigger" | "branch" | "foreach" | "approval" | "await-event";
    runDir: string;
    definitionPath: string;
    startedAt: string;
    /**
     * Effective autonomy posture for this step. For agent steps this is the
     * step's declared `autonomyMode`. For other step types this is the
     * workflow-level default, when declared. Absent only when neither is
     * set.
     */
    autonomyMode?: AutonomyMode;
  };
  "workflow.step.completed": {
    scopeId: ScopeId;
    workflow: string;
    runId: string;
    stepId: string;
    stepType: "tool" | "agent" | "emit" | "restart" | "code" | "parallel" | "trigger" | "branch" | "foreach" | "approval" | "await-event";
    status: "success" | "failed" | "skipped";
    durationMs: number;
    activeDurationMs?: number;
    hostSuspendedMs?: number;
    costUsd?: number;
    runDir: string;
    definitionPath: string;
    trajectoryDiagnostics?: {
      artifactPath: string;
      warningCount: number;
      unsupportedTrajectoryCount: number;
      missingStreamingFramesCount: number;
      missingFinalVerificationAfterEditCount: number;
      repeatedIdenticalFailingCommandCount: number;
      editAfterSuccessfulVerificationCount: number;
      longPreambleWithoutTaskTouchCount: number;
    };
    /** Effective autonomy posture for this step. See {@link workflow.step.started}. */
    autonomyMode?: AutonomyMode;
    skipReason?: WorkflowStepSkipReason;
  };
  "session.start": { sessionId: string; label?: string; channelIdentity?: ChannelUserIdentity };
  "session.end": {
    sessionId: string;
    label?: string;
    error?: string;
    durationMs: number;
  };
  "session.state": {
    sessionId: string;
    from: string;
    to: string;
    meta?: EventPayloadRecord;
  };
  /**
   * An operator (or a client acting on operator behalf) changed a session's
   * autonomy posture. Emitted only when the mode actually changes, so the
   * transition counter observes distinct from → to transitions.
   */
  "session.autonomy.changed": {
    sessionId: string;
    from: AutonomyMode;
    to: AutonomyMode;
  };
  "schedule.fire": {
    scopeId: ScopeId;
    itemId: number;
    description: string;
  };
  "knowledge.create": {
    id: string;
    title: string;
    type: string;
    tags: string[];
    scope: string;
  };
  "knowledge.update": {
    id: string;
    fields: string[];
  };
  "knowledge.delete": {
    id: string;
  };
  "file.changed": {
    watchId: string;
    path: string;
    changes: { path: string; type: "create" | "change" | "delete" }[];
  };
  "confirm.requested": {
    action: string;
    risk: string;
    details: string;
    timeout: number;
  };
  "confirm.resolved": {
    action: string;
    risk: string;
    approved: boolean;
    reason: string;
  };
};
