import type {
  SDKPermissionMode,
  SDKSettingSource,
} from "../agent-sdk/types.js";
import type { BusEvents } from "../event-bus.js";
import type { ToolResult } from "../tools/index.js";

export type WorkflowRetryConfig = {
  maxAttempts: number;
  initialDelayMs: number;
  backoffFactor: number;
};

export type WorkflowAgentBackoffKind = "rate_limit" | "auth" | "provider";

export type WorkflowAgentBackoffState = {
  kind: WorkflowAgentBackoffKind;
  failureCount: number;
  until: string;
  updatedAt: string;
  reason: string;
};

export type WorkflowAgentBackoffSignal = {
  kind: WorkflowAgentBackoffKind;
  reason: string;
};

export type WorkflowFilterScalar = string | number | boolean;
export type WorkflowFilterValue =
  | WorkflowFilterScalar
  | readonly WorkflowFilterScalar[];

export type WorkflowTriggerInput = {
  event?: keyof BusEvents | string;
  filter?: Record<string, WorkflowFilterValue>;
  cooldownMs?: number;
  /** Standard 5-field cron expression (MIN HOUR DOM MONTH DOW). */
  schedule?: string;
  /** Interval in milliseconds. Fires immediately on first run, then every N ms. */
  intervalMs?: number;
};

export type WorkflowTrigger = {
  event: string;
  filter?: Record<string, WorkflowFilterValue>;
  cooldownMs: number;
  /** Standard 5-field cron expression, if this is a schedule trigger. */
  schedule?: string;
  /** Interval in milliseconds, if this is an interval trigger. */
  intervalMs?: number;
};

export type WorkflowRunTrigger = {
  event: string;
  payload: Record<string, unknown>;
};

export type WorkflowRunStatus =
  | "success"
  | "failed"
  | "interrupted"
  | "completed-with-warnings";

export type WorkflowStepStatus = "success" | "failed" | "skipped";

export type WorkflowActiveRun = {
  runId: string;
  workflow: string;
  startedAt: string;
};

export type WorkflowRuntimeState = {
  activeRuns?: WorkflowActiveRun[];
  completedRuns: number;
  totalCostUsd?: number;
  definitionsLoadedAt?: string;
  agentBackoff?: WorkflowAgentBackoffState;
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

export type WorkflowStepContext = {
  projectDir: string;
  workflow: WorkflowContextInfo;
  trigger: WorkflowRunTrigger;
  previousOutput: unknown;
  stepOutputs: Record<string, unknown>;
  stepResults: Record<string, WorkflowStepResult>;
  stepOutputList: unknown[];
  runTool: (
    name: string,
    input: Record<string, unknown>,
  ) => Promise<ToolResult>;
  emit: (event: string, payload: Record<string, unknown>) => void;
  requestRestart: (reason: string) => void;
  readPrompt: (promptPath: string) => string;
  readRuntimeState: () => WorkflowRuntimeState;
};

export type WorkflowValueResolver<T> =
  | T
  | ((context: WorkflowStepContext) => T | Promise<T>);

export type WorkflowPredicate = (
  context: WorkflowStepContext,
) => boolean | Promise<boolean>;

type WorkflowBaseStep = {
  id: string;
  when?: WorkflowPredicate;
  continueOnFailure?: boolean;
};

export type WorkflowRepairCheck = {
  /** Identifier for this check, shown in repair iteration output. */
  id: string;
  tool: string;
  input?: WorkflowValueResolver<Record<string, unknown>>;
};

export type WorkflowRepairLoopConfig = {
  /** Checks to run after the agent step. Failures trigger a repair agent run. */
  checks: WorkflowRepairCheck[];
  /** Maximum number of repair agent runs before giving up and failing the step. */
  maxRepairAttempts: number;
};

export type WorkflowToolStepInput = WorkflowBaseStep & {
  type: "tool";
  tool: string;
  input?: WorkflowValueResolver<Record<string, unknown>>;
  retry?: WorkflowRetryConfig;
};

export type WorkflowAgentStepInput = WorkflowBaseStep & {
  type: "agent";
  /**
   * Name of a registered AgentDef. Provides promptPath, model, permissionMode,
   * and settingSources as defaults; step-level fields override them.
   * Either agentName or promptPath must be provided.
   */
  agentName?: string;
  /**
   * Path to the prompt markdown file (relative to project root).
   * Required when agentName is not set; overrides agent def promptPath when set.
   */
  promptPath?: string;
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  timeoutMs?: number;
  permissionMode?: SDKPermissionMode;
  allowedTools?: string[];
  disallowedTools?: string[];
  settingSources?: SDKSettingSource[];
  retry?: WorkflowRetryConfig;
  repairLoop?: WorkflowRepairLoopConfig;
};

export type WorkflowEmitStepInput = WorkflowBaseStep & {
  type: "emit";
  event: string;
  payload?: WorkflowValueResolver<Record<string, unknown>>;
};

export type WorkflowRestartStepInput = WorkflowBaseStep & {
  type: "restart";
  reason?: WorkflowValueResolver<string>;
  requires?: string[];
};

export type WorkflowCodeStepInput = WorkflowBaseStep & {
  type: "code";
  run: (context: WorkflowStepContext) => Promise<unknown> | unknown;
};

export type WorkflowParallelGroupInput = {
  id: string;
  type: "parallel";
  /** Code steps to run concurrently. Agent steps are not supported in parallel groups. */
  steps: WorkflowCodeStepInput[];
  when?: WorkflowPredicate;
  continueOnFailure?: boolean;
};

export type WorkflowStepInput =
  | WorkflowToolStepInput
  | WorkflowAgentStepInput
  | WorkflowEmitStepInput
  | WorkflowRestartStepInput
  | WorkflowCodeStepInput
  | WorkflowParallelGroupInput;

export type WorkflowDefinitionInput = {
  name: string;
  description?: string;
  enabled?: boolean;
  runTimeoutMs?: number;
  triggers: WorkflowTriggerInput[];
  steps: WorkflowStepInput[];
};

export type RegisteredWorkflowDefinitionInput = WorkflowDefinitionInput & {
  definitionPath: string;
};

export type WorkflowToolStep = WorkflowBaseStep & {
  type: "tool";
  tool: string;
  input?: WorkflowValueResolver<Record<string, unknown>>;
  retry?: WorkflowRetryConfig;
};

export type WorkflowAgentStep = WorkflowBaseStep & {
  type: "agent";
  /** Name of the agent definition used, if the step was configured via agentName. */
  agentName?: string;
  promptPath: string;
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  timeoutMs?: number;
  permissionMode: SDKPermissionMode;
  allowedTools?: string[];
  disallowedTools?: string[];
  settingSources: SDKSettingSource[];
  retry?: WorkflowRetryConfig;
  repairLoop?: WorkflowRepairLoopConfig;
};

export type WorkflowEmitStep = WorkflowBaseStep & {
  type: "emit";
  event: string;
  payload?: WorkflowValueResolver<Record<string, unknown>>;
};

export type WorkflowRestartStep = WorkflowBaseStep & {
  type: "restart";
  reason?: WorkflowValueResolver<string>;
  requires: string[];
};

export type WorkflowCodeStep = WorkflowBaseStep & {
  type: "code";
  run: (context: WorkflowStepContext) => Promise<unknown> | unknown;
};

export type WorkflowParallelGroup = {
  id: string;
  type: "parallel";
  /** Code steps to run concurrently. Agent steps are not supported in parallel groups. */
  steps: WorkflowCodeStep[];
  when?: WorkflowPredicate;
  continueOnFailure?: boolean;
};

export type WorkflowStep =
  | WorkflowToolStep
  | WorkflowAgentStep
  | WorkflowEmitStep
  | WorkflowRestartStep
  | WorkflowCodeStep
  | WorkflowParallelGroup;

export type WorkflowDefinition = {
  name: string;
  description?: string;
  enabled: boolean;
  runTimeoutMs?: number;
  definitionPath: string;
  triggers: WorkflowTrigger[];
  steps: WorkflowStep[];
};

export type WorkflowQueuedRun = {
  workflowName: string;
  trigger: WorkflowRunTrigger;
  enqueuedAtMs: number;
  notBeforeMs: number;
};

export type WorkflowStepResult = {
  id: string;
  type: WorkflowStep["type"];
  status: WorkflowStepStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  output?: unknown;
  error?: string;
  continueOnFailure?: boolean;
};

export type WorkflowRunExecutionResult = {
  metadata: WorkflowRunMetadata;
  agentBackoff?: WorkflowAgentBackoffSignal;
};

export type WorkflowRunMetadata = {
  id: string;
  workflow: string;
  definitionPath: string;
  trigger: WorkflowRunTrigger;
  triggeredByRunId?: string;
  retryOf?: string;
  startedAt: string;
  completedAt?: string;
  status: WorkflowRunStatus | "running";
  durationMs?: number;
  totalCostUsd?: number;
  runDir: string;
  steps: WorkflowStepResult[];
};
