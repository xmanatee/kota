import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  readActiveTaskClaim,
  supersedeTaskClaim,
} from "#modules/autonomy/task-claims.js";
import {
  assessDecomposerFailureInWorker,
  type DecomposerAssessment,
  type DecomposerAssessmentInput,
} from "./blocking-assessment.js";
import {
  type AppliedDecomposition,
  applyDecompositionPlan,
} from "./decomposition-actions.js";
import type { DecompositionPlan } from "./decomposition-plan.js";

export type { AppliedDecomposition } from "./decomposition-actions.js";
export type { DecomposerAssessment };
export { assessDecomposerFailureInWorker };

export type FinalizedSourceClaim = {
  changed: boolean;
  recoveryStatus: string;
};

type ApplyDecompositionInput = {
  projectDir: string;
  taskId: string;
  failedRunId: string;
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
  return applyDecompositionPlan(input);
}

export function finalizeSourceClaimInWorker(
  input: FinalizeSourceClaimInput,
): FinalizedSourceClaim {
  const claim = readActiveTaskClaim(input.projectDir, input.taskId);
  if (
    claim !== null &&
    (claim.status !== "pending-decomposition" || claim.workflowId !== "builder")
  ) {
    throw new Error(
      `Cannot finalize claim for ${input.taskId}: claim is ${claim.workflowId}/${claim.status}`,
    );
  }
  const result = supersedeTaskClaim({
    projectDir: input.projectDir,
    taskId: input.taskId,
    runId: claim?.runId ?? input.failedRunId,
    workflowId: claim?.workflowId ?? "builder",
    evidence: `decomposer ${input.workflowRunId} replaced the exhausted task with bounded subtasks`,
  });
  if (!result.changed && result.claim !== null) {
    throw new Error(
      `Cannot finalize claim for ${input.taskId}: ${result.reason ?? "claim ownership changed"}`,
    );
  }
  return {
    changed: result.changed,
    recoveryStatus: result.recoveryStatus,
  };
}

export const assessDecomposerFailureOperation =
  defineWorkflowBlockingOperation<DecomposerAssessmentInput, DecomposerAssessment>(
    import.meta.url,
    "assessDecomposerFailureInWorker",
  );

export const applyDecompositionOperation = defineWorkflowBlockingOperation<
  ApplyDecompositionInput,
  AppliedDecomposition
>(import.meta.url, "applyDecompositionInWorker");

export const finalizeSourceClaimOperation = defineWorkflowBlockingOperation<
  FinalizeSourceClaimInput,
  FinalizedSourceClaim
>(import.meta.url, "finalizeSourceClaimInWorker");
