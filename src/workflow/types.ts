import type {
  SDKPermissionMode,
  SDKSettingSource,
} from "../agent-sdk/types.js";
import type { BusEvents } from "../event-bus.js";
import type {
  WorkflowPredicate,
  WorkflowRepairLoopConfig,
  WorkflowStepContext,
  WorkflowValueResolver,
} from "./run-types.js";

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

type WorkflowBaseStep = {
  id: string;
  when?: WorkflowPredicate;
  continueOnFailure?: boolean;
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
