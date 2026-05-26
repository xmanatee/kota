import type { TrajectoryDiagnosticsMetadata } from "#core/agent-harness/index.js";
import type { ToolResult } from "#core/tools/index.js";
import type { WorkflowStepProgressReporter } from "./step-idle-timeout.js";
import type { WorkflowAgentStep, WorkflowStep } from "./step-types.js";
import type { WorkflowAgentBackoffSignal, WorkflowAgentBackoffState, WorkflowRunTrigger } from "./trigger-types.js";

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

/**
 * Per-workflow entry in persisted runtime state. `lastStarted` and
 * `lastCompletion` are independent, each self-describing a single run.
 * They may refer to the same run (idle after completion) or different runs
 * (a new run has started before the previous completion rolled off) but
 * fields within each slot always belong to one run.
 */
export type WorkflowStateEntry = {
  lastStarted?: WorkflowRunRef;
  lastCompletion?: WorkflowCompletion;
  nextScheduledAt?: string;
};

export type WorkflowRuntimeState = {
  activeRuns?: WorkflowActiveRun[];
  completedRuns: number;
  totalCostUsd?: number;
  definitionsLoadedAt?: string;
  agentBackoff?: WorkflowAgentBackoffState;
  recovery?: WorkflowRecoveryState;
  pendingRuns: WorkflowQueuedRun[];
  workflows: Record<string, WorkflowStateEntry>;
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
  errorKind?: "idle-timeout";
  idleTimeoutMs?: number;
  continueOnFailure?: boolean;
  toolCalls?: ToolCallSummaryEntry[];
  /** True when this step result was reused from a prior run (resume-from-step). */
  reused?: boolean;
  skipReason?: WorkflowStepSkipReason;
  /**
   * Agent-step only. The adapter name the harness registry actually returned
   * for this step (the result of `resolveAgentHarness(step.harness)`), not the
   * optional raw `step.harness` config. Absent on non-agent steps.
   */
  harness?: string;
  /**
   * Agent-step only. The model identifier the harness ran with — the result
   * of `resolveAgentModel(step, agentConfig)`, including any `agentModels`
   * override. Absent on non-agent steps.
   */
  model?: string;
  /**
   * Agent-step only. Compact advisory process-quality diagnostic counts and
   * artifact path for the KOTA-native message stream.
   */
  trajectoryDiagnostics?: TrajectoryDiagnosticsMetadata;
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
  runTool: WorkflowRunToolRunner;
  emit: (event: string, payload: Record<string, unknown>) => void;
  requestRestart: (reason: string) => void;
  readPrompt: (promptPath: string) => string;
  readRuntimeState: () => WorkflowRuntimeState;
  /**
   * Runtime-owned progress heartbeat for code steps that opt into
   * idleTimeoutMs. This is an explicit typed signal; stdout/log text never
   * resets the idle clock.
   */
  reportProgress: WorkflowStepProgressReporter;
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

export type WorkflowRunToolCallContext = {
  stepId: string;
};

export type WorkflowRunToolRunner = (
  name: string,
  input: Record<string, unknown>,
  context?: WorkflowRunToolCallContext,
) => Promise<ToolResult>;

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
      /**
       * Called once per repair iteration. `parentStep` is the agent step whose
       * repair loop owns this check; critic- and judge-backed checks read
       * `parentStep.harness` so they dispatch through the same registered
       * adapter the step itself resolved from per-step config, config, or the
       * active preset.
       * Mechanical checks can ignore the second argument — TypeScript permits
       * fewer-arg function assignments.
       */
      run: (
        context: WorkflowStepContext,
        parentStep: WorkflowAgentStep,
      ) => Promise<unknown> | unknown;
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
