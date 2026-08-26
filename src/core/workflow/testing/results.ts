import type {
  WorkflowPredicate,
  WorkflowStepContext,
  WorkflowStepResult,
  WorkflowStepSkipReason,
} from "#core/workflow/run-types.js";
import {
  type WorkflowCodeStepInput,
  WorkflowStepOutputValidationError,
} from "#core/workflow/step-input-code.js";
import type { WorkflowStepInput } from "#core/workflow/step-input-types.js";
import type {
  HarnessOptions,
  HarnessOutputValue,
  HarnessStepResult,
} from "./index.js";

export const BRANCH_ARM_NOT_TAKEN: WorkflowStepSkipReason = {
  kind: "branch-arm-not-taken",
};
export const FOREACH_EMPTY: WorkflowStepSkipReason = { kind: "foreach-empty" };
export const PARENT_SKIPPED: WorkflowStepSkipReason = {
  kind: "parent-skipped",
};

export function whenSkipReason(
  when: WorkflowPredicate | undefined,
): WorkflowStepSkipReason {
  return when?.skipLabel
    ? { kind: "when-predicate", label: when.skipLabel }
    : { kind: "when-predicate" };
}

export function makeStepResult(
  id: string,
  type: string,
  status: "success" | "failed" | "skipped",
  output: HarnessOutputValue,
  error: string | undefined,
  skipReason: WorkflowStepSkipReason | undefined,
): { harness: HarnessStepResult; internal: WorkflowStepResult } {
  const now = new Date().toISOString();
  const harness: HarnessStepResult = {
    id,
    type,
    status,
    ...(output !== undefined ? { output } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(skipReason !== undefined ? { skipReason } : {}),
  };
  const internal: WorkflowStepResult = {
    id,
    type: type as WorkflowStepResult["type"],
    status,
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    ...(output !== undefined ? { output } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(skipReason !== undefined ? { skipReason } : {}),
  };
  return { harness, internal };
}

export function validateWorkflowStepOutput<T>(
  step: WorkflowCodeStepInput | WorkflowStepInput,
  rawOutput: T,
  context: WorkflowStepContext,
) {
  if (
    (step.type !== "code" && step.type !== "agent") ||
    step.validate === undefined
  ) {
    return rawOutput;
  }
  try {
    return step.type === "agent"
      ? step.validate(rawOutput, {
          workspaceRoot: context.workspaceRoot,
          stepOutputs: context.stepOutputs,
        })
      : step.validate(rawOutput);
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    throw new WorkflowStepOutputValidationError(step.id, "run", cause);
  }
}

export async function resolveStepMock(
  mock: NonNullable<HarnessOptions["stepMocks"]>[string] | undefined,
  context: WorkflowStepContext,
) {
  if (typeof mock === "function") return await mock(context);
  return mock;
}
