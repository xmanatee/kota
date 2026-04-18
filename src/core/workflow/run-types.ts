import type { ToolResult } from "#core/tools/index.js";
import type {
  WorkflowAgentBackoffSignal,
  WorkflowAgentBackoffState,
  WorkflowRunTrigger,
  WorkflowStep,
} from "./types.js";

export type WorkflowRunStatus =
  | "success"
  | "failed"
  | "interrupted"
  | "completed-with-warnings";

export type WorkflowStepStatus = "success" | "failed" | "skipped";

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

export type WorkflowRecoveryState = {
  sourceRunId: string;
  sourceWorkflow: string;
  worktreeFingerprint: string;
  worktreeSummary: string;
  attempts: number;
  retryAttemptedBy: WorkflowRecoveryRetryAttempt[];
  updatedAt: string;
};

export type WorkflowRuntimeState = {
  activeRuns?: WorkflowActiveRun[];
  completedRuns: number;
  totalCostUsd?: number;
  definitionsLoadedAt?: string;
  agentBackoff?: WorkflowAgentBackoffState;
  recovery?: WorkflowRecoveryState;
  pendingRuns: WorkflowQueuedRun[];
  workflows: Record<
    string,
    {
      lastRunId?: string;
      lastStartedAt?: string;
      lastCompletedAt?: string;
      lastStatus?: WorkflowRunStatus;
      nextScheduledAt?: string;
    }
  >;
};

export type WorkflowContextInfo = {
  name: string;
  definitionPath: string;
  runId: string;
  runDir: string;
  runDirPath: string;
};

export type ToolCallSummaryEntry = {
  tool: string;
  count: number;
  totalMs: number;
};

export type WorkflowStepResult = {
  id: string;
  type: WorkflowStep["type"];
  status: WorkflowStepStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  costUsd?: number;
  output?: unknown;
  error?: string;
  continueOnFailure?: boolean;
  toolCalls?: ToolCallSummaryEntry[];
  /** True when this step result was reused from a prior run (resume-from-step). */
  reused?: boolean;
  skipReason?: WorkflowStepSkipReason;
};

export type WorkflowStepContext = {
  projectDir: string;
  workflow: WorkflowContextInfo;
  trigger: WorkflowRunTrigger;
  previousOutput: unknown;
  stepOutputs: Record<string, unknown>;
  stepResults: Record<string, WorkflowStepResult>;
  stepOutputList: unknown[];
  /** Present when this step is executing inside a foreach loop. Maps the foreach `as` name to the current item. */
  foreach?: Record<string, unknown>;
  runTool: (
    name: string,
    input: Record<string, unknown>,
  ) => Promise<ToolResult>;
  emit: (event: string, payload: Record<string, unknown>) => void;
  requestRestart: (reason: string) => void;
  readPrompt: (promptPath: string) => string;
  readRuntimeState: () => WorkflowRuntimeState;
  /**
   * Queue or run another workflow from within this step.
   * Returns the runId and whether it was queued or completed.
   * Throws if the referenced workflow does not exist.
   */
  triggerWorkflow: (
    workflowName: string,
    payload: Record<string, unknown>,
    waitFor: "queued" | "completed",
    signal?: AbortSignal,
  ) => Promise<{ runId: string; status: "queued" | "completed" | "failed" }>;
};

export type WorkflowValueResolver<T> =
  | T
  | ((context: WorkflowStepContext) => T | Promise<T>);

export type WorkflowPredicate = {
  (context: WorkflowStepContext): boolean | Promise<boolean>;
  skipLabel?: string;
};

export function labeledPredicate(
  label: string,
  predicate: (context: WorkflowStepContext) => boolean | Promise<boolean>,
): WorkflowPredicate {
  const labeled = predicate as WorkflowPredicate;
  labeled.skipLabel = label;
  return labeled;
}

export type WorkflowRepairCheck = {
  /** Identifier for this check, shown in repair iteration output. */
  id: string;
  severity?: "error" | "warning";
  /**
   * Execution phase. Checks with a lower phase run first; later phases are
   * skipped when an earlier phase has failures. Within a phase, checks run
   * in parallel. Default is 0 (mechanical checks). Use phase 1 for semantic
   * checks (e.g. critic review) that should only run after mechanical
   * validations pass.
   */
  phase?: number;
} & (
  | {
      type?: "tool";
      tool: string;
      input?: WorkflowValueResolver<Record<string, unknown>>;
    }
  | {
      type: "code";
      run: (context: WorkflowStepContext) => Promise<unknown> | unknown;
    }
);

export type WorkflowRepairLoopConfig = {
  /** Checks to run after the agent step. Failures trigger a repair agent run. */
  checks: WorkflowRepairCheck[];
  /** Optional operational stop. Omit for quality-first repair until checks pass or the step aborts. */
  maxRepairAttempts?: number;
};

export type WorkflowRunExecutionResult = {
  metadata: WorkflowRunMetadata;
  agentBackoff?: WorkflowAgentBackoffSignal;
};

export type WorkflowRunWarning = {
  type: string;
  message: string;
};

export type WorkflowRunMetadata = {
  id: string;
  workflow: string;
  definitionPath: string;
  trigger: WorkflowRunTrigger;
  triggeredByRunId?: string;
  causedBy?: { runId: string; workflow: string };
  retryOf?: string;
  resumedFromRunId?: string;
  tags?: string[];
  startedAt: string;
  completedAt?: string;
  status: WorkflowRunStatus | "running";
  durationMs?: number;
  totalCostUsd?: number;
  runDir: string;
  steps: WorkflowStepResult[];
  warnings?: WorkflowRunWarning[];
};
