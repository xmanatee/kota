import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { WorkflowDeadLetterBusEvents } from "./event-bus-dead-letter-events.js";
import type { ScopeId } from "./scope.js";

export type TailBusEvents = WorkflowDeadLetterBusEvents & {
  "approval.requested": {
    scopeId: ScopeId;
    id: string;
    tool: string;
    risk: string;
    reason: string;
    source: string;
    sessionId: string;
  };
  "approval.resolved": {
    scopeId: ScopeId;
    id: string;
    tool: string;
    approved: boolean;
    reason: string;
    source: string;
    sessionId: string;
  };
  "workflow.failure.alert": {
    scopeId: ScopeId;
    workflow: string;
    runId: string;
    status: "failed" | "interrupted";
    durationMs: number;
    errorSummary: string;
    text: string;
  };
  "workflow.interrupted.alert": {
    scopeId: ScopeId;
    workflow: string;
    runId: string;
    durationMs: number;
    reason: string;
    text: string;
  };
  "workflow.attention.digest": {
    scopeId: ScopeId;
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
    scopeId: ScopeId;
    /** ISO timestamp at the start of the window covered. */
    windowStartedAt: string;
    /** ISO timestamp at the end of the window covered. */
    windowEndedAt: string;
    /** Human-readable rendered digest body. Channels forward this verbatim. */
    text: string;
    /** True when the window had nothing to report; channels still deliver. */
    quiet: boolean;
  };
  "approval.expired": {
    scopeId: ScopeId;
    id: string;
    tool: string;
  };
  "workflow.approval.timeout": {
    scopeId: ScopeId;
    id: string;
    tool: string;
    defaultResolution: "deny" | "approve";
  };
  "workflow.approval.expired": {
    scopeId: ScopeId;
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
    scopeId: ScopeId;
    id: string;
    pendingCount: number;
  };
  "owner.question.asked": {
    scopeId: ScopeId;
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
    scopeId: ScopeId;
    id: string;
    answered: boolean;
    answer: string;
  };
  "owner.question.dismissed": {
    scopeId: ScopeId;
    id: string;
    reason: string;
  };
  "owner.question.expired": {
    scopeId: ScopeId;
    id: string;
    defaultResolution: "dismiss" | "answer";
  };
  "owner.question.changed": {
    scopeId: ScopeId;
    id: string;
    pendingCount: number;
  };
  "owner.decision.requested": {
    scopeId: ScopeId;
    id: string;
    status: "pending" | "answered" | "canceled" | "expired" | "consumed";
    kind: "single-choice" | "multi-choice" | "free-text" | "form";
    requesterKind: "workflow" | "session" | "manual";
    ownerQuestionId: string | null;
    actionId: string | null;
    workflowName: string | null;
    runId: string | null;
    pendingCount: number;
  };
  "owner.decision.changed": {
    scopeId: ScopeId;
    id: string;
    status: "pending" | "answered" | "canceled" | "expired" | "consumed";
    kind: "single-choice" | "multi-choice" | "free-text" | "form";
    requesterKind: "workflow" | "session" | "manual";
    ownerQuestionId: string | null;
    actionId: string | null;
    workflowName: string | null;
    runId: string | null;
    pendingCount: number;
  };
  "owner.decision.resolved": {
    scopeId: ScopeId;
    id: string;
    status: "pending" | "answered" | "canceled" | "expired" | "consumed";
    kind: "single-choice" | "multi-choice" | "free-text" | "form";
    requesterKind: "workflow" | "session" | "manual";
    ownerQuestionId: string | null;
    actionId: string | null;
    workflowName: string | null;
    runId: string | null;
    pendingCount: number;
  };
  "owner.decision.consumed": {
    scopeId: ScopeId;
    id: string;
    status: "pending" | "answered" | "canceled" | "expired" | "consumed";
    kind: "single-choice" | "multi-choice" | "free-text" | "form";
    requesterKind: "workflow" | "session" | "manual";
    ownerQuestionId: string | null;
    actionId: string | null;
    workflowName: string | null;
    runId: string | null;
    pendingCount: number;
  };
  "task.changed": {
    scopeId: ScopeId;
    counts: { pending: number; in_progress: number; done: number };
  };
  "session.registered": {
    scopeId: ScopeId;
    id: string;
    createdAt: string;
    autonomyMode: AutonomyMode;
  };
  "session.unregistered": {
    scopeId: ScopeId;
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
    scopeId: ScopeId;
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
    scopeId: ScopeId;
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
