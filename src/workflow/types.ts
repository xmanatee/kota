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
  /**
   * When true, this trigger fires when the daemon receives a signed HTTP POST
   * to `POST /webhooks/:workflowName`. Secret is configured in daemon config
   * under `webhooks.<workflowName>.secret`.
   */
  webhook?: boolean;
};

export type WorkflowTrigger = {
  event: string;
  filter?: Record<string, WorkflowFilterValue>;
  cooldownMs: number;
  /** Standard 5-field cron expression, if this is a schedule trigger. */
  schedule?: string;
  /** Interval in milliseconds, if this is an interval trigger. */
  intervalMs?: number;
  /** When true, this trigger fires via the daemon webhook endpoint. */
  webhook?: boolean;
};

export type WorkflowRunTrigger = {
  event: string;
  payload: Record<string, unknown>;
};

type WorkflowBaseStep = {
  id: string;
  when?: WorkflowPredicate;
  continueOnFailure?: boolean;
  /**
   * Maximum time in milliseconds this step is allowed to run. If the step does
   * not complete within this deadline the run fails with a timeout error and the
   * normal failure path executes (failed record, workflow.failure.alert emitted).
   * When omitted, the executor applies DEFAULT_STEP_TIMEOUT_MS (30 minutes).
   * Set to a larger value for known long-running steps.
   */
  timeoutMs?: number;
  /**
   * When true, this step's output is injected into later agent-step prompts.
   * Keep this off by default and only expose runtime-only facts that the agent
   * cannot reasonably discover from the repository itself.
   */
  exposeOutputToAgent?: boolean;
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

/**
 * A typed code step with a compile-time output accessor.
 * Extends WorkflowCodeStepInput and is assignable wherever WorkflowCodeStepInput is accepted.
 */
export type TypedCodeStepInput<T> = WorkflowBaseStep & {
  type: "code";
  run: (context: WorkflowStepContext) => Promise<T> | T;
  /** Returns this step's output from a step context, typed as T. */
  output: (context: WorkflowStepContext) => T;
};

/**
 * Creates a typed code step. The returned step's `output(context)` accessor returns
 * the step's persisted output as `T`, avoiding manual casts in downstream `when`
 * predicates and `run` functions.
 *
 * @example
 * ```ts
 * const myStep = typedCodeStep({
 *   id: "my-step",
 *   run: (): MyOutputType => ({ ... }),
 * });
 *
 * // In a downstream step:
 * when: (ctx) => myStep.output(ctx).someField > 0,
 * ```
 */
export function typedCodeStep<T>(
  def: WorkflowBaseStep & {
    type: "code";
    run: (context: WorkflowStepContext) => Promise<T> | T;
  },
): TypedCodeStepInput<T> {
  return {
    ...def,
    output: (context: WorkflowStepContext): T =>
      context.stepOutputs[def.id] as T,
  };
}

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
  /** Maximum spend (USD) per UTC calendar day before new runs are skipped. */
  dailyBudgetUsd?: number;
  /**
   * Maximum spend (USD) for a single run. If accumulated agent cost exceeds this
   * after any step, the run fails immediately with a descriptive error and the
   * normal failure path executes (failed record, workflow.failure.alert emitted).
   * Omit to allow unlimited spend per run. The global dailyBudgetUsd is unaffected.
   */
  costLimitUsd?: number;
  /**
   * Named concurrency group for this workflow. Workflows in the same named group
   * run at most one at a time. Omit to use type-based defaults: agent-step
   * workflows use the built-in "agent" group (agentConcurrency cap), code-only
   * workflows use the "code" group (codeConcurrency cap).
   */
  concurrencyGroup?: string;
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
  /** Maximum spend (USD) per UTC calendar day before new runs are skipped. */
  dailyBudgetUsd?: number;
  /**
   * Maximum spend (USD) for a single run. If accumulated agent cost exceeds this
   * after any step, the run fails with a descriptive error.
   */
  costLimitUsd?: number;
  /**
   * Named concurrency group. Workflows in the same named group run at most one
   * at a time. Omit to use type-based defaults ("agent" or "code").
   */
  concurrencyGroup?: string;
  definitionPath: string;
  triggers: WorkflowTrigger[];
  steps: WorkflowStep[];
};
