import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  readActiveTaskClaim,
  supersedeTaskClaim,
} from "#modules/autonomy/task-claims.js";
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

export type FinalizedSourceClaim = {
  changed: boolean;
  recoveryStatus: string;
};

type ApplyDecompositionInput = {
  projectDir: string;
  assessment: Extract<DecomposerAssessment, { shouldDecompose: true }>;
  plan: DecompositionPlan;
};

type FinalizeSourceClaimInput = {
  projectDir: string;
  taskId: string;
  failedRunId: string;
  workflowRunId: string;
};


export function applyDecompositionInWorker(
  input: ApplyDecompositionInput,
): AppliedDecomposition {
  assertDecompositionOwnership(input.projectDir, input.assessment);
  return applyDecompositionPlan({
    projectDir: input.projectDir,
    taskId: input.assessment.taskId,
    failedRunId: input.assessment.failedRunId,
    plan: input.plan,
  });
}

export function finalizeSourceClaimInWorker(
  input: FinalizeSourceClaimInput,
): FinalizedSourceClaim {
  const claim = readActiveTaskClaim(input.projectDir, input.taskId);
  if (
    claim === null ||
    claim.status !== "pending-decomposition" ||
    claim.workflowId !== "builder" ||
    claim.runId !== input.failedRunId
  ) {
    throw new Error(
      `Cannot finalize claim for ${input.taskId}: expected builder/${input.failedRunId}/pending-decomposition ownership`,
    );
  }
  const result = supersedeTaskClaim({
    projectDir: input.projectDir,
    taskId: input.taskId,
    runId: input.failedRunId,
    workflowId: "builder",
    evidence: `decomposer ${input.workflowRunId} replaced the exhausted task with bounded subtasks`,
  });
  if (!result.changed) {
    throw new Error(
      `Cannot finalize claim for ${input.taskId}: ${result.reason ?? "claim ownership changed"}`,
    );
  }
  return {
    changed: result.changed,
    recoveryStatus: result.recoveryStatus,
  };
}

export const applyDecompositionOperation = defineWorkflowBlockingOperation<
  ApplyDecompositionInput,
  AppliedDecomposition
>(import.meta.url, "applyDecompositionInWorker");

export const finalizeSourceClaimOperation = defineWorkflowBlockingOperation<
  FinalizeSourceClaimInput,
  FinalizedSourceClaim
>(import.meta.url, "finalizeSourceClaimInWorker");
