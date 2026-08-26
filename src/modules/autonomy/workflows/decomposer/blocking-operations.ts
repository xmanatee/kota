import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  assertDecompositionOwnership,
  type DecomposerAssessment,
} from "./assessment.js";
import {
  type AppliedDecomposition,
  applyDecompositionPlan,
} from "./decomposition-actions.js";
import type { DecompositionPlan } from "./decomposition-plan.js";

export type { AppliedDecomposition } from "./decomposition-actions.js";
export type { DecomposerAssessment };

type ApplyDecompositionInput = {
  workspaceRoot: string;
  stateDir: string;
  assessment: Extract<DecomposerAssessment, { shouldDecompose: true }>;
  plan: DecompositionPlan;
};

export function applyDecompositionInWorker(
  input: ApplyDecompositionInput,
): AppliedDecomposition {
  assertDecompositionOwnership(input.workspaceRoot, input.stateDir, input.assessment);
  return applyDecompositionPlan({
    workspaceRoot: input.workspaceRoot,
    taskId: input.assessment.taskId,
    failedRunId: input.assessment.failedRunId,
    plan: input.plan,
  });
}

export const applyDecompositionOperation = defineWorkflowBlockingOperation<
  ApplyDecompositionInput,
  AppliedDecomposition
>(import.meta.url, "applyDecompositionInWorker");
