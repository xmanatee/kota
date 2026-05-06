import type { WorkflowStepContext } from "./run-types.js";
import type { WorkflowBaseStep } from "./step-input-base.js";

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
