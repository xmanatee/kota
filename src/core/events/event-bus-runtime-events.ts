import type { ChannelUserIdentity } from "#core/channels/channel.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { WorkflowStepSkipReason } from "#core/workflow/run-types.js";
import type { DaemonConfigReloadEvent, ScopeLifecycleEvent } from "./event-bus-lifecycle-types.js";
import type { EventPayloadRecord } from "./event-bus-types.js";
import type { ProjectId } from "./project-scope.js";

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

type QueueClaimBlockedTask = {
  id: string;
  title: string;
  state: "ready" | "doing";
  claimStatus: string;
  recoveryStatus: string;
  recoveryPath: string;
  owner: string;
  runId: string;
  workflowId: string;
  evidence: string | null;
};

/**
 * Known event payloads. Extend this map to add new typed events.
 *
 * Directory-scope event payloads carry a required `projectId` compatibility
 * field in this static map. Emitters that route through `ProjectScopedEventBus`
 * also receive the canonical `scopeId` field at runtime, so workflow filters
 * and clients can use scope terminology without breaking existing projectId
 * callers.
 *
 * Daemon-wide events (module loader, model provider failover) intentionally
 * omit scope attribution. Tool-call-level guardrail events stay session-bound
 * rather than directory-scope attributed.
 */
export type RuntimeBusEvents = {
  "runtime.idle": {
    projectId: ProjectId;
    timestamp: string;
    idleIntervalMs: number;
  };
  "runtime.restart_requested": {
    projectId: ProjectId;
    reason?: string;
    workflow?: string;
    runId?: string;
    requires?: string[];
  };
  "daemon.config.reload": DaemonConfigReloadEvent;
  "scope.lifecycle.changed": ScopeLifecycleEvent;
  "autonomy.queue.available": {
    projectId: ProjectId;
    pullableCount: number;
    actionableCount: number;
    dispatchableCount?: number;
    counts: QueueCounts;
    dependencyBlockedTasks: QueueDependencyBlockedTask[];
    claimBlockedTasks?: QueueClaimBlockedTask[];
  };
  "autonomy.builder.recovery.requested": {
    projectId: ProjectId;
    taskId: string;
    sourceRunId: string;
    worktreeRunId: string;
    workspaceDir: string;
    idempotencyKey: string;
    reason: string;
  };
  "autonomy.inbox.available": {
    projectId: ProjectId;
    inboxCount: number;
  };
  "autonomy.queue.needs-promotion": {
    projectId: ProjectId;
    backlogCount: number;
    promotableBacklogCount: number;
    dispatchableCount?: number;
    counts: QueueCounts;
    dependencyBlockedTasks: QueueDependencyBlockedTask[];
    claimBlockedTasks?: QueueClaimBlockedTask[];
  };
  "autonomy.queue.empty": {
    projectId: ProjectId;
    counts: QueueCounts;
    dependencyBlockedTasks: QueueDependencyBlockedTask[];
    claimBlockedTasks?: QueueClaimBlockedTask[];
  };
  "autonomy.blocked-research.attemptable": {
    projectId: ProjectId;
    candidateCount: number;
    attemptableCount: number;
    counts: QueueCounts;
  };
  "autonomy.queue.thin": {
    projectId: ProjectId;
    pullableCount: number;
    promotableBacklogCount: number;
    dispatchableCount?: number;
    counts: QueueCounts;
    dependencyBlockedTasks: QueueDependencyBlockedTask[];
    claimBlockedTasks?: QueueClaimBlockedTask[];
  };
  "workflow.started": {
    projectId: ProjectId;
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
    projectId: ProjectId;
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
  };
  "workflow.step.started": {
    projectId: ProjectId;
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
    projectId: ProjectId;
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
    projectId: ProjectId;
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
