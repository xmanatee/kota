import type { AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import type { BusEvents } from "#core/events/event-bus.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
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
   * When omitted, the executor applies DEFAULT_STEP_TIMEOUT_MS as a hang rail.
   * Set this only when a step has a clearer operational deadline.
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
  /** Path to the prompt markdown file, relative to the owning module's root. */
  promptPath?: string;
  /**
   * Name of the agent harness adapter this step should run on. Must match a
   * harness registered with the core `agent-harness` registry. When omitted,
   * the step inherits `KotaConfig.defaultAgentHarness`; the validator rejects
   * any step that leaves the harness unset with no config default. There is
   * no hidden fallback to `claude-agent-sdk`.
   */
  harness?: string;
  model: string;
  /**
   * How hard the model should think on each step. Required — KOTA workflows
   * optimize for quality, so every agent step must declare its effort level
   * explicitly rather than relying on a hidden default.
   */
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxTurns?: number;
  thinkingEnabled?: boolean;
  thinkingBudget?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  /**
   * Harness-neutral passthrough for per-step options that only one registered
   * harness knows how to interpret. The block is a single-key object whose key
   * must match the step's resolved harness name; the value is opaque to core
   * and validated by that harness's `validateStepOptions` method. Leave unset
   * to inherit the harness defaults. The core validator rejects any key that
   * does not match the resolved harness, and any harness without a registered
   * `validateStepOptions`.
   */
  harnessOptions?: Record<string, unknown>;
  /**
   * Operator supervision mode for this step. Orthogonal to per-tool risk
   * classification. Required in effect: the validator rejects an agent step
   * that neither sets this nor inherits it from the enclosing workflow's
   * `defaultAutonomyMode`. Declaring the mode is how a workflow states its
   * supervision intent — there is no repo-wide default.
   */
  autonomyMode?: AutonomyMode;
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
};

export type WorkflowDefinitionInput = {
  name: string;
  description?: string;
  enabled?: boolean;
  runTimeoutMs?: number;
  /**
   * Absolute path to the root of the module that ships this workflow. Relative
   * paths inside the definition (notably `promptPath`) are resolved against
   * this root so a workflow can be contributed by a module whose source lives
   * outside the daemon's current `projectDir` (e.g. KOTA's own autonomy
   * workflows while the daemon is pointed at an external project).
   * When omitted, the loader falls back to the daemon's project directory.
   */
  moduleRoot?: string;
  /**
   * When true, this workflow is eligible for dirty-worktree recovery dispatch.
   * Only workflows that can commit, stash, or reset should declare this.
   */
  recoveryCapable?: boolean;
  /**
   * Workflow-level default for every agent step's `autonomyMode`. When set, any
   * agent step in this workflow (including steps nested inside parallel, branch,
   * or foreach) that omits its own `autonomyMode` inherits this value. When
   * omitted, every agent step in the workflow must declare its own mode; the
   * validator rejects any step that leaves the mode undefined. Individual
   * steps may still override this default with a stricter mode.
   */
  defaultAutonomyMode?: AutonomyMode;
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
   * (onFailure: true, onSuccess: false).
   */
  notify?: WorkflowNotifyConfig;
  tags?: readonly string[];
  triggers: WorkflowTriggerInput[];
  steps: WorkflowStepInput[];
};

export type WorkflowContributionSource = "project" | "installed" | "foreign";

export type RegisteredWorkflowDefinitionInput = WorkflowDefinitionInput & {
  definitionPath: string;
  /**
   * Name of the module that contributed this workflow. Populated by the module
   * loader when iterating contributions; absent for workflows registered
   * directly (e.g. by tests or by the daemon config's `workflows` array).
   */
  contributingModule?: string;
  /**
   * Where the contributing module was discovered. Populated by the module
   * loader in lockstep with `contributingModule`. Used by the validator to
   * produce actionable error messages on name collisions.
   *
   * - `"project"` — KOTA's own `src/modules/*` tree.
   * - `"installed"` — the target project's `<projectDir>/.kota/modules/*`.
   * - `"foreign"` — a module registered via `foreignModules` in config.
   */
  moduleSource?: WorkflowContributionSource;
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
  /**
   * Registered agent harness name. Populated by the validator when the step
   * declares `harness`, or from `KotaConfig.defaultAgentHarness` when it has
   * config access.
   */
  harness: string;
  promptPath: string;
  /**
   * Absolute filesystem root inherited from the enclosing workflow definition.
   * `promptPath` is resolved against this root by the step executor and the
   * repair loop so workflows contributed by KOTA's own modules keep reading
   * their prompts from KOTA's install tree even when the daemon is running
   * against an external project.
   */
  moduleRoot: string;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxTurns?: number;
  thinkingEnabled?: boolean;
  thinkingBudget?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  /**
   * Validated per-step harness-specific options. Single-key record whose key
   * equals the step's resolved harness name and whose value is the fragment
   * returned by `AgentHarness.validateStepOptions`. Opaque to core at
   * runtime — the step executor merges the fragment into neutral run options
   * before invoking the harness.
   */
  harnessOptions?: Record<string, Partial<AgentHarnessRunOptions>>;
  /** Operator supervision mode applied to this agent step. */
  autonomyMode: AutonomyMode;
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
  /**
   * Absolute filesystem root of the module that ships this workflow. Populated
   * by the loader (or the module itself) and used at runtime to resolve
   * `promptPath` values against KOTA's own install tree even when the daemon
   * is pointed at an external project directory.
   */
  moduleRoot: string;
  recoveryCapable: boolean;
  /**
   * Workflow-level default for agent-step autonomy mode. Populated by the
   * loader when the workflow definition sets `defaultAutonomyMode`; used only
   * by the validator when normalizing agent steps and not re-read at runtime.
   */
  defaultAutonomyMode?: AutonomyMode;
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
   * Omit to use defaults (onFailure: true, onSuccess: false).
   */
  notify?: WorkflowNotifyConfig;
  tags: readonly string[];
  definitionPath: string;
  triggers: WorkflowTrigger[];
  steps: WorkflowStep[];
};
