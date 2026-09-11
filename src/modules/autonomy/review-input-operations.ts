import {
  defineWorkflowBlockingOperation,
  type WorkflowBlockingOperationContext,
} from "#core/workflow/blocking-operation.js";
import {
  findExpectedTaskReviewTarget,
  findTaskReviewTarget,
  type TaskReviewContract,
  type TaskReviewTarget,
} from "./task-review-target.js";
import {
  getWorkflowChangedFiles,
  getWorkflowDiffContent,
  getWorkflowDiffStat,
} from "./workflow-diff.js";

export type CriticReviewInspectionInput =
  | { reviewDir: string; taskMutationStatus: string }
  | { reviewDir: string; taskContract: TaskReviewContract };

export type CriticReviewInspectionResult =
  | { status: "no-task" }
  | {
      status: "open";
      target: TaskReviewTarget;
      diffStat: string;
      diffContent: string;
      changedFiles: string;
    };

export function inspectCriticReviewInWorker(
  input: CriticReviewInspectionInput,
  context?: WorkflowBlockingOperationContext,
): CriticReviewInspectionResult {
  context?.reportProgress("critic-task-inspection");
  const target = "taskContract" in input
    ? findExpectedTaskReviewTarget(input.reviewDir, input.taskContract)
    : findTaskReviewTarget(input.reviewDir, input.taskMutationStatus);
  if (target === null) return { status: "no-task" };

  const diffStat = getWorkflowDiffStat(input.reviewDir);
  const diffContent = getWorkflowDiffContent(input.reviewDir);
  const changedFiles = getWorkflowChangedFiles(input.reviewDir);

  return {
    status: "open",
    target,
    diffStat,
    diffContent,
    changedFiles,
  };
}

export const criticReviewInspectionOperation =
  defineWorkflowBlockingOperation<
    CriticReviewInspectionInput,
    CriticReviewInspectionResult
  >(import.meta.url, "inspectCriticReviewInWorker");
