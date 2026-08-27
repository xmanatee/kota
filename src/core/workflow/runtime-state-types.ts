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
  /** Trigger identity retained so task views can derive transient in-progress state. */
  trigger?: WorkflowRunTrigger;
};

export type WorkflowQueuedRun = {
  runId?: string;
  workflowName: string;
  trigger: WorkflowRunTrigger;
  enqueuedAtMs: number;
  notBeforeMs: number;
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

/** Durable projection of one workflow's latest start and completion. */
export type WorkflowStateEntry = {
  lastStarted?: WorkflowRunRef;
  lastCompletion?: WorkflowCompletion;
  /** Live projection from the scheduler's current timer, never persisted. */
  nextScheduledAt?: string;
};

export type WorkflowRuntimeSummary = {
  completedRuns: number;
  workflows: Record<string, WorkflowStateEntry>;
};

export type WorkflowRuntimeOperationalState = {
  activeRuns: WorkflowActiveRun[];
  pendingRuns: WorkflowQueuedRun[];
};

export type WorkflowRuntimeSnapshot = WorkflowRuntimeSummary &
  WorkflowRuntimeOperationalState & {
    definitionsLoadedAt?: string;
    agentBackoff?: WorkflowAgentBackoffState;
    batchBuffers?: WorkflowBatchBuffers;
  };
