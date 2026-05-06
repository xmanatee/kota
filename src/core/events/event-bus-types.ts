import type { ChannelUserIdentity } from "#core/channels/channel.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { WorkflowStepSkipReason } from "#core/workflow/run-types.js";

/** Known event payloads. Extend this map to add new typed events. */
export type BusEvents = {
  "runtime.idle": {
    timestamp: string;
    idleIntervalMs: number;
  };
  "runtime.restart_requested": {
    reason?: string;
    workflow?: string;
    runId?: string;
    requires?: string[];
  };
  "autonomy.queue.available": {
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
    inboxCount: number;
  };
  "autonomy.queue.empty": {
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
    id: string;
    tool: string;
    risk: string;
    reason: string;
    source: string;
  };
  "approval.resolved": {
    id: string;
    tool: string;
    approved: boolean;
    reason: string;
  };
  "workflow.failure.alert": {
    workflow: string;
    runId: string;
    status: "failed" | "interrupted";
    durationMs: number;
    errorSummary: string;
    text: string;
  };
  "workflow.interrupted.alert": {
    workflow: string;
    runId: string;
    durationMs: number;
    reason: string;
    text: string;
  };
  "workflow.attention.digest": {
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
    runId: string;
    taskId: string | null;
    commitMessage: string;
    costUsd: number | null;
    durationMs: number | null;
  };
  "approval.expired": {
    id: string;
    tool: string;
  };
  "workflow.approval.timeout": {
    id: string;
    tool: string;
    defaultResolution: "deny" | "approve";
  };
  "workflow.approval.expired": {
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
    id: string;
    pendingCount: number;
  };
  "owner.question.asked": {
    id: string;
    question: string;
    reason: string;
    source: string;
  };
  "owner.question.resolved": {
    id: string;
    answered: boolean;
    answer: string;
  };
  "owner.question.dismissed": {
    id: string;
    reason: string;
  };
  "owner.question.expired": {
    id: string;
    defaultResolution: "dismiss" | "answer";
  };
  "owner.question.changed": {
    id: string;
    pendingCount: number;
  };
  "task.changed": {
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

/** An event as seen by wildcard listeners: type + payload. */
export type BusEnvelope<K extends string = string> = {
  type: K;
  payload: K extends keyof BusEvents ? BusEvents[K] : Record<string, unknown>;
};

export type BusEventHandler<T = Record<string, unknown>> = (payload: T) => void;
