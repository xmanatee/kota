import type {
  SDKPermissionMode,
  SDKSettingSource,
} from "#core/agent-sdk/types.js";
import type { BusEvents } from "#core/events/event-bus.js";
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
  /**
   * IANA timezone name for cron schedule evaluation (e.g. `"America/Los_Angeles"`).
   * When set, the cron expression is evaluated in the named timezone's wall-clock
   * time, so the workflow fires at the correct local time across daylight saving
   * transitions. When omitted, the process local timezone is used.
   * Only valid when `schedule` is also set.
   */
  timezone?: string;
  /** Interval in milliseconds. Fires immediately on first run, then every N ms. */
  intervalMs?: number;
  /**
   * When true, this trigger fires when the daemon receives a signed HTTP POST
   * to `POST /webhooks/:workflowName`. Secret is configured in daemon config
   * under `webhooks.<workflowName>.secret`.
   */
  webhook?: boolean;
  /**
   * Glob pattern (or array of patterns) to watch. When matching files change,
   * the workflow is queued with a `files.changed` event payload listing the
   * affected paths. Only active when the daemon is running.
   */
  watch?: string | string[];
  /**
   * Debounce delay in milliseconds for watch triggers. Minimum 200ms. Defaults
   * to 500ms.
   */
  debounceMs?: number;
};

export type WorkflowTrigger = {
  event: string;
  filter?: Record<string, WorkflowFilterValue>;
  cooldownMs: number;
  /** Standard 5-field cron expression, if this is a schedule trigger. */
  schedule?: string;
  /** IANA timezone for cron evaluation. Omitted means process local timezone. */
  timezone?: string;
  /** Interval in milliseconds, if this is an interval trigger. */
  intervalMs?: number;
  /** When true, this trigger fires via the daemon webhook endpoint. */
  webhook?: boolean;
  /** Glob patterns for file-watch triggers. */
  watch?: string[];
  /** Debounce delay in milliseconds for watch triggers. */
  debounceMs?: number;
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
   * Optional logical agent label. Use this for model overrides and telemetry.
   * Execution does not resolve workflow steps through a global agent catalog.
   */
  agentName?: string;
  /** Path to the prompt markdown file (relative to project root). */
  promptPath?: string;
  model: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  /**
   * Per-step spend cap enforced by KOTA after each agent run completes. When
   * the step's reported cost exceeds this value the step fails with a
   * `cost_cap_exceeded` error. The failure message includes the actual spend,
   * the cap, and the step name. Optional — omitting it preserves current behavior.
   */
  maxCostUsd?: number;
  thinkingEnabled?: boolean;
  thinkingBudget?: number;
  permissionMode?: SDKPermissionMode;
  allowedTools?: string[];
  disallowedTools?: string[];
  settingSources?: SDKSettingSource[];
  retry?: WorkflowRetryConfig;
  repairLoop?: WorkflowRepairLoopConfig;
  /**
   * When set to "json", a short instruction is appended to the agent prompt asking
   * it to end its response with a fenced JSON block. After the step completes, the
   * last fenced JSON block is extracted from the agent's final message and becomes
   * the step output (parsed). The step fails if no valid JSON block is found.
   */
  outputFormat?: "json";
  /**
   * Optional JSON Schema object (same subset as inputSchema/outputSchema at the
   * definition level) to validate the extracted JSON against. Requires
   * outputFormat: "json". A schema mismatch fails the step with a descriptive error.
   */
  outputSchema?: Record<string, unknown>;
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

export type WorkflowTriggerStepInput = WorkflowBaseStep & {
  type: "trigger";
  /** Name of the workflow to queue. */
  workflow: string;
  /** Optional payload passed to the triggered run. Supports `{{trigger.payload.field}}` interpolation. */
  payload?: WorkflowValueResolver<Record<string, unknown>>;
  /**
   * When to consider the step complete.
   * - "queued" (default): step completes as soon as the run is accepted into the queue.
   * - "completed": step blocks until the triggered run finishes (success or failure).
   *   Respects step-level timeoutMs; defaults to DEFAULT_STEP_TIMEOUT_MS.
   */
  waitFor?: "queued" | "completed";
};

export type WorkflowParallelGroupInput = {
  id: string;
  type: "parallel";
  /** Code and agent steps to run concurrently. Emit, restart, trigger, and nested parallel steps are not supported. */
  steps: (WorkflowCodeStepInput | WorkflowAgentStepInput)[];
  when?: WorkflowPredicate;
  continueOnFailure?: boolean;
  /**
   * Maximum number of agent steps that may execute simultaneously within this group.
   * Defaults to the number of agent steps in the group (no cap).
   * Useful when the group has many agent steps and you want to avoid overwhelming the API.
   */
  maxParallelAgents?: number;
};

export type WorkflowBranchStepInput = WorkflowBaseStep & {
  type: "branch";
  /** Evaluated with an empty context at definition load time to determine the branch path. */
  condition: WorkflowPredicate;
  /** Steps to execute when condition returns true. */
  ifTrue: WorkflowStepInput[];
  /** Steps to execute when condition returns false. Omit for a no-op false branch. */
  ifFalse?: WorkflowStepInput[];
};

export type WorkflowForeachStepInput = WorkflowBaseStep & {
  type: "foreach";
  /**
   * Resolver that returns the array to iterate over. May be a static array or a function
   * that receives the step context and returns a (possibly async) array.
   */
  items: WorkflowValueResolver<unknown[]>;
  /** Name to use for the current item inside inner step resolvers, accessible via `ctx.foreach.<name>`. */
  as: string;
  /** Code and agent steps to run for each item. foreach, parallel, branch, trigger, emit, and restart are not supported inside a foreach body. */
  steps: (WorkflowCodeStepInput | WorkflowAgentStepInput)[];
  /**
   * Maximum number of items to execute concurrently. Defaults to 1 (serial).
   * Must be a positive integer. Values > 1 are rejected if any inner step is an agent step.
   */
  maxConcurrency?: number;
  /**
   * When true and `continueOnFailure: true`, a workflow retry will skip items that
   * succeeded in the prior run and re-run only the failed items. The merged output
   * preserves successful results from the prior run alongside new results.
   * Requires `continueOnFailure: true`. Defaults to false.
   */
  retryFailedItems?: boolean;
};

export type WorkflowApprovalStepInput = WorkflowBaseStep & {
  type: "approval";
  /**
   * Human-readable description of what is being approved. Shown in `kota approval list`
   * and the web UI alongside the workflow name, run ID, and step ID.
   */
  reason?: string;
  /**
   * What to do when timeoutMs elapses without a human decision.
   * - "deny" (default): the approval expires and the run fails.
   * - "approve": the approval auto-approves and the run continues.
   */
  defaultResolution?: "deny" | "approve";
};

export type WorkflowStepInput =
  | WorkflowToolStepInput
  | WorkflowAgentStepInput
  | WorkflowEmitStepInput
  | WorkflowRestartStepInput
  | WorkflowCodeStepInput
  | WorkflowTriggerStepInput
  | WorkflowParallelGroupInput
  | WorkflowBranchStepInput
  | WorkflowForeachStepInput
  | WorkflowApprovalStepInput;

export type WorkflowNotifyConfig = {
  /**
   * When false, suppresses `workflow.failure.alert` for this workflow.
   * Default: true (emit on failure).
   */
  onFailure?: boolean;
  /**
   * When false, suppresses `workflow.build.committed` emit steps for this workflow.
   * Default: false (suppress by default — this event is opt-in at the channel level).
   */
  onSuccess?: boolean;
  /**
   * When false, suppresses `workflow.cost.anomaly` for this workflow.
   * Default: true (emit when anomaly detected).
   */
  onCostAnomaly?: boolean;
};

export type WorkflowDefinitionInput = {
  name: string;
  description?: string;
  enabled?: boolean;
  runTimeoutMs?: number;
  /**
   * When true, this workflow is eligible for dirty-worktree recovery dispatch.
   * Only workflows that can commit, stash, or reset should declare this.
   */
  recoveryCapable?: boolean;
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
   * Multiplier over the rolling average cost (last 10 successful runs) that
   * triggers a `workflow.cost.anomaly` alert. Requires at least 3 historical
   * runs before firing. Omit to disable anomaly detection for this workflow.
   * Example: 3.0 fires when a run costs more than 3× the historical average.
   */
  costAnomalyThreshold?: number;
  /**
   * Named concurrency group for this workflow. Workflows in the same named group
   * run at most one at a time. Omit to use type-based defaults: agent-step
   * workflows use the default "agent" group (agentConcurrency cap), code-only
   * workflows use the "code" group (codeConcurrency cap).
   */
  concurrencyGroup?: string;
  /**
   * Optional JSON Schema object describing the expected shape of trigger payloads.
   * When present, the runtime validates each trigger payload against this schema
   * before queuing the run. Invalid payloads are rejected with a descriptive error.
   * Workflows without this field accept any payload (existing behavior).
   */
  inputSchema?: Record<string, unknown>;
  /**
   * Optional JSON Schema object describing the expected shape of the workflow's
   * last step output. When present and the run completes successfully, the runtime
   * validates the last step output against this schema. A mismatch marks the run
   * `completed-with-warnings` and appends a structured warning — the output is
   * still recorded. Workflows without this field behave exactly as before.
   */
  outputSchema?: Record<string, unknown>;
  /**
   * Rate limit configuration for inbound webhook triggers. When set, the daemon
   * rejects requests that exceed the cap with 429 Too Many Requests. The counter
   * uses a sliding 60-second window and resets in daemon memory (lost on restart).
   * Default: no cap applied.
   */
  webhookRateLimit?: { maxPerMinute: number };
  /**
   * Per-event notification suppression for this workflow. Omit to use defaults
   * (onFailure: true, onCostAnomaly: true, onSuccess: false).
   */
  notify?: WorkflowNotifyConfig;
  tags?: readonly string[];
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
  model: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  maxCostUsd?: number;
  thinkingEnabled?: boolean;
  thinkingBudget?: number;
  permissionMode: SDKPermissionMode;
  allowedTools?: string[];
  disallowedTools?: string[];
  settingSources: SDKSettingSource[];
  retry?: WorkflowRetryConfig;
  repairLoop?: WorkflowRepairLoopConfig;
  outputFormat?: "json";
  outputSchema?: Record<string, unknown>;
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

export type WorkflowTriggerStep = WorkflowBaseStep & {
  type: "trigger";
  workflow: string;
  payload?: WorkflowValueResolver<Record<string, unknown>>;
  waitFor: "queued" | "completed";
};

export type WorkflowParallelGroup = {
  id: string;
  type: "parallel";
  /** Code and agent steps to run concurrently. */
  steps: (WorkflowCodeStep | WorkflowAgentStep)[];
  when?: WorkflowPredicate;
  continueOnFailure?: boolean;
  /** Maximum number of agent steps allowed to run simultaneously. Defaults to group size. */
  maxParallelAgents?: number;
};

export type WorkflowBranchStep = WorkflowBaseStep & {
  type: "branch";
  condition: WorkflowPredicate;
  ifTrue: WorkflowStep[];
  ifFalse: WorkflowStep[];
};

export type WorkflowForeachStep = WorkflowBaseStep & {
  type: "foreach";
  items: WorkflowValueResolver<unknown[]>;
  as: string;
  steps: (WorkflowCodeStep | WorkflowAgentStep)[];
  /** Maximum number of items to execute concurrently. Defaults to 1 (serial). */
  maxConcurrency?: number;
  /** When true and `continueOnFailure: true`, retries re-run only failed items. */
  retryFailedItems?: boolean;
};

export type WorkflowApprovalStep = WorkflowBaseStep & {
  type: "approval";
  reason?: string;
  defaultResolution?: "deny" | "approve";
};

export type WorkflowStep =
  | WorkflowToolStep
  | WorkflowAgentStep
  | WorkflowEmitStep
  | WorkflowRestartStep
  | WorkflowCodeStep
  | WorkflowTriggerStep
  | WorkflowParallelGroup
  | WorkflowBranchStep
  | WorkflowForeachStep
  | WorkflowApprovalStep;

export type WorkflowDefinition = {
  name: string;
  description?: string;
  enabled: boolean;
  runTimeoutMs?: number;
  recoveryCapable: boolean;
  /** Maximum spend (USD) per UTC calendar day before new runs are skipped. */
  dailyBudgetUsd?: number;
  /**
   * Maximum spend (USD) for a single run. If accumulated agent cost exceeds this
   * after any step, the run fails with a descriptive error.
   */
  costLimitUsd?: number;
  /**
   * Multiplier over the rolling average cost (last 10 successful runs) that
   * triggers a `workflow.cost.anomaly` alert. Requires at least 3 historical
   * runs before firing. Omit to disable anomaly detection for this workflow.
   */
  costAnomalyThreshold?: number;
  /**
   * Named concurrency group. Workflows in the same named group run at most one
   * at a time. Omit to use type-based defaults ("agent" or "code").
   */
  concurrencyGroup?: string;
  /** Optional JSON Schema for validating trigger payloads at enqueue time. */
  inputSchema?: Record<string, unknown>;
  /** Optional JSON Schema for validating the last step output on successful completion. */
  outputSchema?: Record<string, unknown>;
  /**
   * Rate limit configuration for inbound webhook triggers. When set, the daemon
   * enforces a sliding 60-second window cap and returns 429 when exceeded.
   * Default: no cap applied.
   */
  webhookRateLimit?: { maxPerMinute: number };
  /**
   * Per-event notification suppression for this workflow.
   * Omit to use defaults (onFailure: true, onCostAnomaly: true, onSuccess: false).
   */
  notify?: WorkflowNotifyConfig;
  tags: readonly string[];
  definitionPath: string;
  triggers: WorkflowTrigger[];
  steps: WorkflowStep[];
};
