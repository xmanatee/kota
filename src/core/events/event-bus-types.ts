import type { ChannelUserIdentity } from "#core/channels/channel.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { WorkflowStepSkipReason } from "#core/workflow/run-types.js";
import type { ProjectId } from "./project-scope.js";

export type DaemonConfigReloadEvent =
  | {
      timestamp: string;
      scope: "daemon";
      outcome: "success";
      reloadKind: "full" | "module-scoped" | "noop";
      fullReload: boolean;
      changedModules: string[];
      workflowCount: number;
    }
  | {
      timestamp: string;
      scope: "daemon";
      outcome: "failure";
      reloadKind: "failed";
      fullReload: false;
      changedModules: [];
      workflowCount: number;
      errorClass: string;
      errorMessage: string;
    };

/**
 * Known event payloads. Extend this map to add new typed events.
 *
 * Project-scoped event payloads carry a required `projectId` field — every
 * event a project-bound subsystem emits (workflow runtime, run store,
 * scheduler, task store, approval/owner-question queues, notification gate,
 * queue-shape) is attributed to exactly one project.
 *
 * Daemon-wide events (module loader, model provider failover) intentionally
 * omit `projectId`. Cross-process session register/unregister and
 * tool-call-level guardrail events stay daemon-default until session
 * projectId attribution lands; their wire shape is owned by other slices.
 */
export type BusEvents = {
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
  "autonomy.queue.available": {
    projectId: ProjectId;
    pullableCount: number;
    actionableCount: number;
    counts: {
      backlog: number;
      ready: number;
      doing: number;
      blocked: number;
      done: number;
      dropped: number;
    };
  };
  "autonomy.inbox.available": {
    projectId: ProjectId;
    inboxCount: number;
  };
  "autonomy.queue.empty": {
    projectId: ProjectId;
    counts: {
      backlog: number;
      ready: number;
      doing: number;
      blocked: number;
      done: number;
      dropped: number;
    };
  };
  "autonomy.blocked-research.attemptable": {
    projectId: ProjectId;
    candidateCount: number;
    attemptableCount: number;
    counts: {
      backlog: number;
      ready: number;
      doing: number;
      blocked: number;
      done: number;
      dropped: number;
    };
  };
  "autonomy.queue.thin": {
    projectId: ProjectId;
    pullableCount: number;
    counts: {
      backlog: number;
      ready: number;
      doing: number;
      blocked: number;
      done: number;
      dropped: number;
    };
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
     * (rate_limit, auth, provider). Populated from the same classifier that
     * drives agent-dispatch backoff so subscribers — tracing, metrics — can
     * observe the failure class without parsing error strings.
     */
    failureKind?: "rate_limit" | "auth" | "provider";
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
    costUsd?: number;
    runDir: string;
    definitionPath: string;
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
    meta?: Record<string, unknown>;
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
  "approval.requested": {
    projectId: ProjectId;
    id: string;
    tool: string;
    risk: string;
    reason: string;
    source: string;
    sessionId: string;
  };
  "approval.resolved": {
    projectId: ProjectId;
    id: string;
    tool: string;
    approved: boolean;
    reason: string;
    source: string;
    sessionId: string;
  };
  "workflow.failure.alert": {
    projectId: ProjectId;
    workflow: string;
    runId: string;
    status: "failed" | "interrupted";
    durationMs: number;
    errorSummary: string;
    text: string;
  };
  "workflow.interrupted.alert": {
    projectId: ProjectId;
    workflow: string;
    runId: string;
    durationMs: number;
    reason: string;
    text: string;
  };
  "workflow.attention.digest": {
    projectId: ProjectId;
    items: { label: string; detail: string }[];
    text: string;
  };
  /**
   * Periodic operator-facing rollup of what KOTA accomplished over a rolling
   * window. Complement to `workflow.attention.digest`: the attention digest
   * is exception-side ("here are conditions that need a human"), the daily
   * digest is positive-side ("here is the rhythm of work that landed and
   * what is still pending"). Emitted by the `daily-digest` workflow on a
   * fixed cadence; channels (Telegram, Slack, email, webhook) treat
   * `payload.text` as the human-readable body.
   */
  "workflow.daily.digest": {
    projectId: ProjectId;
    /** ISO timestamp at the start of the window covered. */
    windowStartedAt: string;
    /** ISO timestamp at the end of the window covered. */
    windowEndedAt: string;
    /** Human-readable rendered digest body. Channels forward this verbatim. */
    text: string;
    /** True when the window had nothing to report; channels still deliver. */
    quiet: boolean;
  };
  "workflow.build.committed": {
    projectId: ProjectId;
    runId: string;
    taskId: string | null;
    commitMessage: string;
    costUsd: number | null;
    durationMs: number | null;
  };
  "approval.expired": {
    projectId: ProjectId;
    id: string;
    tool: string;
  };
  "workflow.approval.timeout": {
    projectId: ProjectId;
    id: string;
    tool: string;
    defaultResolution: "deny" | "approve";
  };
  "workflow.approval.expired": {
    projectId: ProjectId;
    workflowName: string;
    runId: string;
    stepId: string;
    resolution: "approve" | "deny";
    reason?: string;
    text: string;
  };
  "guardrail.assessed": {
    tool: string;
    risk: string;
    policy: string;
    reason: string;
    session?: string;
  };
  "approval.changed": {
    projectId: ProjectId;
    id: string;
    pendingCount: number;
  };
  "owner.question.asked": {
    projectId: ProjectId;
    id: string;
    question: string;
    reason: string;
    source: string;
    context: string;
    answerBehavior: "workflow-resume" | "record-only" | "unknown";
    origin:
      | {
          kind: "workflow";
          workflowName: string;
          runId: string;
          stepId: string | null;
          taskId: string | null;
        }
      | { kind: "session"; sessionId: string | null }
      | { kind: "manual"; source: string };
    proposedAnswers: string[];
    timeoutMs: number | null;
    defaultResolution: "dismiss" | "answer" | null;
    defaultAnswer: string | null;
  };
  "owner.question.resolved": {
    projectId: ProjectId;
    id: string;
    answered: boolean;
    answer: string;
  };
  "owner.question.dismissed": {
    projectId: ProjectId;
    id: string;
    reason: string;
  };
  "owner.question.expired": {
    projectId: ProjectId;
    id: string;
    defaultResolution: "dismiss" | "answer";
  };
  "owner.question.changed": {
    projectId: ProjectId;
    id: string;
    pendingCount: number;
  };
  "task.changed": {
    projectId: ProjectId;
    counts: { pending: number; in_progress: number; done: number };
  };
  "session.registered": {
    id: string;
    createdAt: string;
    autonomyMode: AutonomyMode;
  };
  "session.unregistered": {
    id: string;
  };
  "module.failed": {
    name: string;
    reason: string;
  };
  "module.restarted": {
    name: string;
    reason: string;
    totalRestarts: number;
  };
  "module.crash.alert": {
    name: string;
    restartCount: number;
    windowMs: number;
    text: string;
  };
  "model.provider.failover": {
    from: string;
    to: string;
    reason: string;
    direction: "failover" | "recovery";
  };
  /**
   * The live-run evaluator calibration monitor observed that the critic's
   * pass-verdict contradiction rate crossed the configured threshold. The
   * payload carries the aggregate window, the rates, and the threshold the
   * gate enforced so observers can explain the drift to an operator without
   * reopening the underlying calibration artifacts. Complements
   * `eval-harness.regression.detected`: fixtures catch generator drift
   * against fixed outcomes; this event catches evaluator drift on live runs.
   */
  "evaluator-calibration.regression.detected": {
    projectId: ProjectId;
    windowStartMs: number;
    windowEndMs: number;
    totalRuns: number;
    passVerdictCount: number;
    passContradictionCount: number;
    passContradictionRate: number;
    passWithWarningsCount: number;
    passWithWarningsFollowUpCount: number;
    passWithWarningsFollowUpRate: number;
    thresholdRate: number;
    passWithWarningsThresholdRate: number;
    /**
     * Drift kinds the gate fired on. Both can fire in the same payload.
     */
    driftKinds: ("pass-contradiction" | "pass-with-warnings-escalation")[];
    /**
     * Outcome of the deterministic corrective action attempted by the
     * monitor against the repo-tasks queue. `noop` means an existing repair
     * task was already in flight; `created`/`recreated`/`promoted` mean a
     * concrete next action lands in `ready/`. `skipped` means the monitor
     * could not run the corrective path (worktree dirty or recovery trigger).
     */
    repairAction: "noop" | "created" | "recreated" | "promoted" | "skipped";
    reason: string;
  };
  /**
   * The cadence workflow compared a fresh eval-set aggregate against the
   * persisted baseline and the gate fired. The payload carries everything
   * an observer needs to explain the regression to an operator without
   * reopening the run artifacts (baseline and candidate aggregates,
   * host-class, noise band, drop, and a typed reason string from the gate).
   */
  "eval-harness.regression.detected": {
    projectId: ProjectId;
    baseline: {
      fixtureCount: number;
      repeatCount: number;
      passAtK: number;
      passHatK: number;
    };
    candidate: {
      fixtureCount: number;
      repeatCount: number;
      passAtK: number;
      passHatK: number;
    };
    hostClass: string;
    noiseBandPercentagePoints: number;
    dropPercentagePoints: number;
    runArtifactBaseDir: string;
    reason: string;
  };
};

/**
 * Set of {@link BusEvents} keys whose payload carries a `projectId` field —
 * the typed registry of project-scoped event names. Workflow runtime, daemon
 * stores, queue-shape emitters, etc. emit only these names through the
 * project-scoped wrapper. Daemon-wide names (`module.*`, `model.*`,
 * `session.*` for now) are intentionally excluded.
 */
export type ProjectScopedBusEventName = {
  [K in keyof BusEvents]: BusEvents[K] extends { projectId: ProjectId } ? K : never;
}[keyof BusEvents];

/** Payload of a project-scoped BusEvents entry minus the injected `projectId`. */
export type ProjectScopedBusEventPayload<K extends ProjectScopedBusEventName> =
  Omit<BusEvents[K], "projectId">;

/** An event as seen by wildcard listeners: type + payload. */
export type BusEnvelope<K extends string = string> = {
  type: K;
  payload: K extends keyof BusEvents ? BusEvents[K] : Record<string, unknown>;
};

export type BusEventHandler<T = Record<string, unknown>> = (payload: T) => void;
