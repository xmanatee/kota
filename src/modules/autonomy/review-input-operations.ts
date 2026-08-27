import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

export type ImproverSemanticInspectionInput = {
  workspaceRoot: string;
  runDirPath: string;
};

export type ImproverSemanticInspectionResult =
  | { status: "no-changes" }
  | {
      status: "open";
      changedFiles: string;
      diffStat: string;
      diffContent: string;
      commitMessage: string;
    };

export function inspectImproverSemanticReviewInWorker(
  input: ImproverSemanticInspectionInput,
): ImproverSemanticInspectionResult {
  const changedFiles = getWorkflowChangedFiles(input.workspaceRoot);
  if (!changedFiles.trim()) return { status: "no-changes" };

  const diffStat = getWorkflowDiffStat(input.workspaceRoot);
  const diffContent = getWorkflowDiffContent(input.workspaceRoot);
  const commitMessagePath = join(input.runDirPath, "commit-message.txt");
  const commitMessage = existsSync(commitMessagePath)
    ? readFileSync(commitMessagePath, "utf8").trim()
    : "(no commit message found)";
  return {
    status: "open",
    changedFiles,
    diffStat,
    diffContent,
    commitMessage,
  };
}

export const improverSemanticInspectionOperation =
  defineWorkflowBlockingOperation<
    ImproverSemanticInspectionInput,
    ImproverSemanticInspectionResult
  >(import.meta.url, "inspectImproverSemanticReviewInWorker");
