import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  defineWorkflowBlockingOperation,
  type WorkflowBlockingOperationContext,
} from "#core/workflow/blocking-operation.js";
import { fileLineCitationsFromUnifiedDiff } from "./review-scrutiny-citations.js";
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
      status: "ready";
      target: TaskReviewTarget;
      diffStat: string;
      diffContent: string;
      changedFiles: string;
      fallbackFileLineCitations: string[];
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
    status: "ready",
    target,
    diffStat,
    diffContent,
    changedFiles,
    fallbackFileLineCitations: fileLineCitationsFromUnifiedDiff(diffContent),
  };
}

export const criticReviewInspectionOperation =
  defineWorkflowBlockingOperation<
    CriticReviewInspectionInput,
    CriticReviewInspectionResult
  >(import.meta.url, "inspectCriticReviewInWorker");

export type ImproverSemanticInspectionInput = {
  projectDir: string;
  runDirPath: string;
};

export type ImproverSemanticInspectionResult =
  | { status: "no-changes" }
  | {
      status: "ready";
      changedFiles: string;
      diffStat: string;
      diffContent: string;
      commitMessage: string;
      fallbackFileLineCitations: string[];
    };

export function inspectImproverSemanticReviewInWorker(
  input: ImproverSemanticInspectionInput,
): ImproverSemanticInspectionResult {
  const changedFiles = getWorkflowChangedFiles(input.projectDir);
  if (!changedFiles.trim()) return { status: "no-changes" };

  const diffStat = getWorkflowDiffStat(input.projectDir);
  const diffContent = getWorkflowDiffContent(input.projectDir);
  const commitMessagePath = join(input.runDirPath, "commit-message.txt");
  const commitMessage = existsSync(commitMessagePath)
    ? readFileSync(commitMessagePath, "utf8").trim()
    : "(no commit message found)";
  return {
    status: "ready",
    changedFiles,
    diffStat,
    diffContent,
    commitMessage,
    fallbackFileLineCitations: fileLineCitationsFromUnifiedDiff(diffContent),
  };
}

export const improverSemanticInspectionOperation =
  defineWorkflowBlockingOperation<
    ImproverSemanticInspectionInput,
    ImproverSemanticInspectionResult
  >(import.meta.url, "inspectImproverSemanticReviewInWorker");
