import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import type { ShadowSemanticReviewArtifactRef } from "./shadow-semantic-review-types.js";
import { getWorkflowChangeEvidence } from "./workflow-diff.js";

export function workflowMutationArtifacts(
  workspaceRoot: string,
): ShadowSemanticReviewArtifactRef[] {
  try {
    const evidence = getWorkflowChangeEvidence(workspaceRoot);
    return [
      {
        path: "git:workflow-mutation-files",
        content: evidence.changedFiles,
      },
      {
        path: "git:workflow-mutation-diff-stat",
        content: evidence.diffStat,
      },
      {
        path: "git:workflow-mutation-diff",
        content: evidence.diffContent,
      },
    ];
  } catch (error) {
    return [
      {
        path: "git:workflow-mutation-diff-error",
        content: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}

export type ShadowSemanticReviewTargetOperationInput = {
  kind: "workflow-mutations";
  workspaceRoot: string;
};

export function collectShadowSemanticReviewTargetsInWorker(
  input: ShadowSemanticReviewTargetOperationInput,
): ShadowSemanticReviewArtifactRef[] {
  return workflowMutationArtifacts(input.workspaceRoot);
}

export const shadowSemanticReviewTargetOperation =
  defineWorkflowBlockingOperation<
    ShadowSemanticReviewTargetOperationInput,
    ShadowSemanticReviewArtifactRef[]
  >(import.meta.url, "collectShadowSemanticReviewTargetsInWorker");
