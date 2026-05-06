import type {
  WorkflowPredicate,
  WorkflowValueResolver,
} from "./run-types.js";
import type {
  WorkflowAgentStepInput,
  WorkflowBaseStep,
} from "./step-input-base.js";
import type { WorkflowCodeStepInput } from "./step-input-code.js";
import type { WorkflowStepInput } from "./step-input-types.js";

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
