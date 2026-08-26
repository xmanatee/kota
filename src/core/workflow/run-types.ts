import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
  TrajectoryDiagnosticsMetadata,
} from "#core/agent-harness/index.js";
import type { AgentUsage } from "#core/agent-harness/usage.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import type { ScopePolicySnapshot } from "#core/daemon/scope-policy.js";
import type { EventJournal } from "#core/events/event-journal.js";
import type { AgentRuntimeSelection } from "#core/model/preset.js";
import type { ToolResult, ToolRunnerContext } from "#core/tools/index.js";
import type { RunRepositoryAccess, TransactionalRunState } from "./run-context.js";
import type {
  WorkflowRunStatus,
  WorkflowRuntimeSummary,
  WorkflowStepErrorKind,
  WorkflowStepSkipReason,
  WorkflowStepStatus,
} from "./runtime-state-types.js";
import type { WorkflowStepProgressReporter } from "./step-idle-timeout.js";
import type {
  WorkflowAgentRunContractSpec,
  WorkflowAgentStep,
  WorkflowStep,
} from "./step-types.js";
import type { WorkflowAgentBackoffSignal, WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowCommandRunner } from "./workflow-command.js";

export * from "./runtime-state-types.js";

export type WorkflowContextInfo = {
  name: string;
  definitionPath: string;
  runId: string;
  runDir: string;
  runDirPath: string;
};

export type WorkflowRuntimeResourcePortRange = {
  start: number;
  end: number;
};

export type WorkflowRuntimeResources = {
  profileId: string;
  env: Record<string, string>;
  agentRunDir?: string;
  tempRoot?: string;
  artifactRoot?: string;
  ports?: WorkflowRuntimeResourcePortRange;
};

export type ToolCallSummaryEntry = {
  tool: string;
  count: number;
  totalMs: number;
};

type WorkflowStepResultBase = {
  id: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  activeDurationMs?: number;
  hostSuspendedMs?: number;
  output?: unknown;
  error?: string;
  errorKind?: WorkflowStepErrorKind;
  idleTimeoutMs?: number;
  continueOnFailure?: boolean;
  toolCalls?: ToolCallSummaryEntry[];
  /** True when this step result was reused from a prior run (resume-from-step). */
  reused?: boolean;
};

type WorkflowSkippedStepResult = WorkflowStepResultBase & {
  type: WorkflowStep["type"];
  status: "skipped";
  skipReason: WorkflowStepSkipReason;
  usage?: never;
  harness?: never;
  model?: never;
  trajectoryDiagnostics?: never;
};

type WorkflowAgentStepResult = WorkflowStepResultBase & {
  type: "agent";
  status: Exclude<WorkflowStepStatus, "skipped">;
  usage: AgentUsage;
  skipReason?: never;
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

type WorkflowNonAgentStepResult = WorkflowStepResultBase & {
  type: Exclude<WorkflowStep["type"], "agent">;
  status: Exclude<WorkflowStepStatus, "skipped">;
  usage?: never;
  skipReason?: never;
  harness?: never;
  model?: never;
  trajectoryDiagnostics?: never;
};

export type WorkflowStepResult =
  | WorkflowSkippedStepResult
  | WorkflowAgentStepResult
  | WorkflowNonAgentStepResult;

export type WorkflowStepContext = {
  /** The current step's cancellation and timeout signal during runtime execution. */
  signal?: AbortSignal;
  approvalQueue?: ApprovalQueue;
  /** Isolated repository view owned by this run. */
  projectDir: string;
  /** Opaque runtime-issued authority for repository mutations. */
  repositoryAccess?: RunRepositoryAccess;
  /** Canonical configured scope root; use only for runtime state that is not repository data. */
  scopeDir: string;
  agentRuntime: AgentRuntimeSelection;
  runtimeResources?: WorkflowRuntimeResources;
  /** Canonical durable runtime-state directory for this scope. */
  stateDir: string;
  eventJournal?: EventJournal;
  /**
   * The authoritative resolved scope policy captured when this step starts.
   * Code steps use this snapshot for policy-derived decisions and evidence;
   * tool and agent calls continue to re-check the live authority at their own
   * execution boundaries.
   */
  scopePolicySnapshot?: ScopePolicySnapshot;
  workflow: WorkflowContextInfo;
  trigger: WorkflowRunTrigger;
  previousOutput: unknown;
  stepOutputs: Record<string, unknown>;
  stepResults: Record<string, WorkflowStepResult>;
  stepOutputList: unknown[];
  /** Present when this step is executing inside a foreach loop. Maps the foreach `as` name to the current item. */
  foreach?: Record<string, unknown>;
  /** Run a subprocess through the workflow runtime's supervised process rail. */
  runCommand: WorkflowCommandRunner;
  /** Read and stage project-scoped JSON state committed only with run success. */
  state: TransactionalRunState;
  runTool: WorkflowRunToolRunner;
  runAgentHarness: WorkflowAgentHarnessRunner;
  emit: (
    event: string,
    payload: Record<string, unknown>,
    options?: Readonly<{
      delivery?: "on-run-success";
      stepId: string;
    }>,
  ) => void;
  requestRestart: (reason: string) => void;
  readPrompt: (promptPath: string) => string;
  readRuntimeState: () => WorkflowRuntimeSummary;
  deadLetterQueue?: DeadLetterQueueStore;
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
    triggerId?: string,
  ) => Promise<{ runId: string; status: "queued" | "completed" | "failed" }>;
};

export type WorkflowRunToolCallContext = ToolRunnerContext & {
  stepId: string;
  /**
   * Optional stable identity for a tool invocation. Declarative executors set
   * it explicitly; code steps receive a deterministic step-local identity.
   */
  effectId?: string;
};

export type WorkflowRunToolRunner = (
  name: string,
  input: Record<string, unknown>,
  context?: WorkflowRunToolCallContext,
) => Promise<ToolResult>;

export type WorkflowAgentHarnessRunner = (
  harness: AgentHarness,
  options: Omit<AgentHarnessRunOptions, "abortController">,
  execution?: {
    signal?: AbortSignal;
    workspaceKey?: string;
    writer?: AgentHarnessWriter;
  },
) => Promise<AgentHarnessResult>;

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
      /**
       * Pure declaration for code checks that launch a judge agent. Definition
       * validation resolves this against the parent step before dispatch; the
       * check must use the same resolved contract at runtime.
       */
      resolveAgentContract?: (
        parentStep: WorkflowAgentStep,
      ) => WorkflowAgentRunContractSpec;
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
  activeDurationMs?: number;
  hostSuspendedMs?: number;
  usage?: AgentUsage;
  runDir: string;
  steps: WorkflowStepResult[];
  warnings?: WorkflowRunWarning[];
};
