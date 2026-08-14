import type {
  WorkflowAgentBackoffKind,
  WorkflowAgentBackoffState,
  WorkflowBatchBuffers,
  WorkflowRunTrigger,
} from "./trigger-types.js";

export type WorkflowRunStatus =
  | "success"
  | "failed"
  | "interrupted"
  | "completed-with-warnings";

export type WorkflowStepStatus = "success" | "failed" | "skipped";

export type WorkflowStepTimeoutErrorKind = "idle-timeout" | "step-timeout";
export type WorkflowRepairErrorKind =
  | "repair-no-progress"
  | "repair-attempts-exhausted";
export type WorkflowStepErrorKind =
  | WorkflowStepTimeoutErrorKind
  | WorkflowRepairErrorKind
  | WorkflowAgentBackoffKind;

export function isWorkflowStepTimeoutErrorKind(
  kind: WorkflowStepErrorKind | undefined,
): kind is WorkflowStepTimeoutErrorKind {
  return kind === "idle-timeout" || kind === "step-timeout";
}

export function isWorkflowRepairErrorKind(
  kind: WorkflowStepErrorKind | undefined,
): kind is WorkflowRepairErrorKind {
  return kind === "repair-no-progress" || kind === "repair-attempts-exhausted";
}

export type WorkflowStepSkipReasonKind =
  | "when-predicate"
  | "branch-arm-not-taken"
  | "parent-skipped"
  | "foreach-empty";

export type WorkflowStepSkipReason = {
  kind: WorkflowStepSkipReasonKind;
  label?: string;
};

export type WorkflowActiveRun = {
  runId: string;
  workflow: string;
  startedAt: string;
};

export type WorkflowQueuedRun = {
  runId?: string;
  workflowName: string;
  trigger: WorkflowRunTrigger;
  enqueuedAtMs: number;
  notBeforeMs: number;
};

export type WorkflowRecoveryRetryAttempt = {
  workflow: string;
  runId: string;
  attemptedAt: string;
};

export type WorkflowRecoveryDirtyCheckout = "canonical" | "workspace";

export type WorkflowRecoveryState = {
  sourceRunId: string;
  sourceWorkflow: string;
  dirtyCheckout?: WorkflowRecoveryDirtyCheckout;
  worktreeFingerprint: string;
  worktreeSummary: string;
  attempts: number;
  retryAttemptedBy: WorkflowRecoveryRetryAttempt[];
  updatedAt: string;
};

export type WorkflowRunRef = {
  runId: string;
  startedAt: string;
};

export type WorkflowCompletion = {
  runId: string;
  startedAt: string;
  completedAt: string;
  status: WorkflowRunStatus;
};

/** Persisted state for one workflow's latest start and completion. */
export type WorkflowStateEntry = {
  lastStarted?: WorkflowRunRef;
  lastCompletion?: WorkflowCompletion;
  nextScheduledAt?: string;
};

export type WorkflowRuntimeState = {
  activeRuns?: WorkflowActiveRun[];
  completedRuns: number;
  totalCostUsd?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  definitionsLoadedAt?: string;
  agentBackoff?: WorkflowAgentBackoffState;
  recovery?: WorkflowRecoveryState;
  batchBuffers?: WorkflowBatchBuffers;
  pendingRuns: WorkflowQueuedRun[];
  workflows: Record<string, WorkflowStateEntry>;
};
