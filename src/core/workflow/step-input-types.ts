import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type {
  WorkflowPredicate,
  WorkflowRepairLoopConfig,
  WorkflowStepContext,
  WorkflowValueResolver,
} from "./run-types.js";
import type { WorkflowRetryConfig } from "./trigger-types.js";

export type WorkflowBaseStep = {
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

/**
 * Decoder that validates a raw step output and returns the typed value.
 * The decoder runs both immediately after `run()` (catching shape drift in
 * fresh executions) and again on every `output(ctx)` access (catching
 * persisted/resumed/manually-loaded values that no longer match `T`).
 * Throw a descriptive `Error` to fail validation; the executor wraps it in
 * a `WorkflowStepOutputValidationError` with the offending step id.
 */
export type CodeStepOutputValidator<T> = (rawOutput: unknown) => T;

/**
 * Common minimal decoder: assert that `raw` is a non-null, non-array object
 * carrying every key in `requiredKeys`, then return it as `T`. Suitable for
 * the typical case where the typed shape is large but downstream callers
 * depend only on a few load-bearing fields.
 *
 * @example
 * ```ts
 * validate: (raw) => expectStructuredOutput<MyType>(raw, ["status", "count"])
 * ```
 */
export function expectStructuredOutput<T>(
  raw: unknown,
  requiredKeys: readonly (keyof T & string)[],
): T {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      `expected structured object output, got ${
        raw === null ? "null" : Array.isArray(raw) ? "array" : typeof raw
      }`,
    );
  }
  const obj = raw as Record<string, unknown>;
  for (const key of requiredKeys) {
    if (!(key in obj)) {
      throw new Error(`missing required field "${String(key)}"`);
    }
  }
  return raw as T;
}

/**
 * Common minimal decoder for steps whose output is an array of `T`. Optionally
 * validates each element through a per-item decoder.
 */
export function expectArrayOutput<T>(
  raw: unknown,
  itemDecoder?: CodeStepOutputValidator<T>,
): T[] {
  if (!Array.isArray(raw)) {
    throw new Error(`expected array output, got ${raw === null ? "null" : typeof raw}`);
  }
  if (itemDecoder !== undefined) {
    return raw.map((item) => itemDecoder(item));
  }
  return raw as T[];
}

export type WorkflowCodeStepInput = WorkflowBaseStep & {
  type: "code";
  run: (context: WorkflowStepContext) => Promise<unknown> | unknown;
  /**
   * Optional runtime decoder for the step's output. When set, it runs after
   * `run()` and replaces the raw value with the validated decode. Required for
   * any code step whose output is consumed by a downstream step or `when`
   * predicate — see `typedCodeStep` for the typed helper.
   */
  validate?: CodeStepOutputValidator<unknown>;
};

/**
 * A typed code step with a runtime-validated output accessor.
 * Extends WorkflowCodeStepInput and is assignable wherever WorkflowCodeStepInput is accepted.
 */
export type TypedCodeStepInput<T> = WorkflowBaseStep & {
  type: "code";
  run: (context: WorkflowStepContext) => Promise<T> | T;
  validate: CodeStepOutputValidator<T>;
  /**
   * Returns this step's output from a step context, decoded as `T`.
   * Returns `undefined` when the step was skipped (its `when` predicate
   * returned false) or has not yet run. Re-runs `validate` against the
   * persisted value on every successful access so a resumed or otherwise-
   * corrupted output cannot be silently consumed downstream.
   */
  output: (context: WorkflowStepContext) => T | undefined;
  /**
   * Strict variant of {@link output}: throws a descriptive error when the
   * step has been skipped or has not yet run. Use from callers that gate
   * themselves on the step having succeeded so the type narrows to `T`
   * without a manual undefined check.
   */
  outputRequired: (context: WorkflowStepContext) => T;
};

/**
 * Thrown when a code step's `validate` decoder rejects a raw output. Carries
 * the failing step id and the surface that produced the value (`run` for
 * post-execution validation, `persisted` when an `output(ctx)` accessor
 * re-validates a persisted/resumed value) so the run artifact and step
 * failure record can pinpoint the offending boundary.
 */
export class WorkflowStepOutputValidationError extends Error {
  readonly stepId: string;
  readonly source: "run" | "persisted";
  readonly cause: Error;

  constructor(stepId: string, source: "run" | "persisted", cause: Error) {
    super(
      `Step "${stepId}" output failed validation (${source}): ${cause.message}`,
    );
    this.name = "WorkflowStepOutputValidationError";
    this.stepId = stepId;
    this.source = source;
    this.cause = cause;
  }
}

function decodeStepOutput<T>(
  stepId: string,
  source: "run" | "persisted",
  validate: CodeStepOutputValidator<T>,
  rawOutput: unknown,
): T {
  try {
    return validate(rawOutput);
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    throw new WorkflowStepOutputValidationError(stepId, source, cause);
  }
}

/**
 * Creates a typed code step. The returned step's `output(context)` accessor
 * runs `validate` against the persisted raw value and returns the decoded `T`,
 * so downstream `when` predicates and `run` functions never read an
 * unvalidated cast. The same `validate` runs in the executor immediately
 * after `run()` so fresh shape drift surfaces as a step failure with the
 * step id attached.
 *
 * @example
 * ```ts
 * const myStep = typedCodeStep<MyOutputType>({
 *   id: "my-step",
 *   type: "code",
 *   run: (): MyOutputType => ({ ... }),
 *   validate: (raw) => {
 *     if (!raw || typeof raw !== "object") throw new Error("expected object");
 *     // ...further field checks...
 *     return raw as MyOutputType;
 *   },
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
    validate: CodeStepOutputValidator<T>;
  },
): TypedCodeStepInput<T> {
  const output = (context: WorkflowStepContext): T | undefined => {
    const raw = context.stepOutputs[def.id];
    if (raw === undefined) return undefined;
    if (
      raw !== null &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      (raw as { skipped?: unknown }).skipped === true &&
      Object.keys(raw as Record<string, unknown>).length === 1
    ) {
      // The run-executor stamps `{ skipped: true }` for skipped steps so
      // downstream `output(ctx)` callers can distinguish "skipped" from
      // "decoded T". Validation is opt-out only for that exact marker; an
      // arbitrary object that happens to carry `skipped: true` still flows
      // through `validate` so genuine output drift cannot hide behind it.
      return undefined;
    }
    return decodeStepOutput(def.id, "persisted", def.validate, raw);
  };
  const outputRequired = (context: WorkflowStepContext): T => {
    const value = output(context);
    if (value === undefined) {
      throw new Error(
        `Step "${def.id}" outputRequired() called but the step was skipped or has not yet run`,
      );
    }
    return value;
  };
  return { ...def, output, outputRequired };
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

export type WorkflowAwaitEventStepInput = WorkflowBaseStep & {
  type: "await-event";
  /** Bus event name to wait for. */
  event: string;
  /**
   * Field on the event payload whose value must equal `matchValue`. Defaults
   * to "id". Producers of the awaited event must include this field.
   */
  matchField?: string;
  /**
   * Scalar (or resolver returning one) to match against `event.payload[matchField]`.
   * Suspension persistence captures the resolved value so a daemon-restart
   * resume reproduces the same match without re-running the resolver.
   */
  matchValue: WorkflowValueResolver<string | number>;
  /**
   * Wait deadline in milliseconds. When the deadline passes, the step
   * resolves to a typed `{ kind: "timeout" }` output instead of an event
   * payload. When omitted, the step waits until matched or aborted.
   *
   * This is distinct from the base step's `timeoutMs` (a runtime hang rail
   * that fails the step). Await-event steps bypass the default hang rail
   * because operator-loop waits can legitimately be long.
   */
  awaitTimeoutMs?: number;
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
  | WorkflowApprovalStepInput
  | WorkflowAwaitEventStepInput;

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
