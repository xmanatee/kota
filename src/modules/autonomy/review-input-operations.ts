import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  defineWorkflowBlockingOperation,
  type WorkflowBlockingOperationContext,
} from "#core/workflow/blocking-operation.js";
import {
  getChangedFiles,
  getStagedDiff,
  getStagedDiffContent,
} from "./critic-diff.js";
import { runProbeIfDeclared } from "./critic-runtime-probe.js";
import {
  checkProductOperatorEvidence,
  type ProductOperatorEvidenceCheck,
} from "./product-evidence.js";
import { fileLineCitationsFromUnifiedDiff } from "./review-scrutiny-citations.js";
import type { TaskProbeResult } from "./task-probe.js";
import {
  findTaskReviewTarget,
  type TaskReviewTarget,
} from "./task-review-target.js";

export type CriticReviewInspectionInput = {
  reviewDir: string;
  runDir: string;
  durableEvidenceDir: string;
  artifactWorkspaceDir?: string;
};

export type CriticReviewInspectionResult =
  | { status: "no-task" }
  | {
      status: "ready";
      target: TaskReviewTarget;
      diffStat: string;
      diffContent: string;
      changedFiles: string;
      probeResult: TaskProbeResult | null;
      productEvidence: ProductOperatorEvidenceCheck;
      fallbackFileLineCitations: string[];
    };

export function inspectCriticReviewInWorker(
  input: CriticReviewInspectionInput,
  context?: WorkflowBlockingOperationContext,
): CriticReviewInspectionResult {
  context?.reportProgress("critic-task-inspection");
  const target = findTaskReviewTarget(input.reviewDir);
  if (target === null) return { status: "no-task" };

  const diffStat = getStagedDiff(input.reviewDir);
  const diffContent = getStagedDiffContent(input.reviewDir);
  const changedFiles = getChangedFiles(input.reviewDir);
  context?.reportProgress("critic-runtime-probe");
  const probeResult = runProbeIfDeclared(
    target.content,
    target.path,
    input.reviewDir,
    input.runDir,
    input.artifactWorkspaceDir,
  );
  const productEvidence = checkProductOperatorEvidence({
    taskContent: target.content,
    taskState: target.state,
    evidenceDirPath: input.durableEvidenceDir,
    changedFiles,
    hasRuntimeProbeResult: probeResult !== null,
  });

  return {
    status: "ready",
    target,
    diffStat,
    diffContent,
    changedFiles,
    probeResult,
    productEvidence,
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
  const changedFiles = getChangedFiles(input.projectDir);
  if (!changedFiles.trim()) return { status: "no-changes" };

  const diffStat = getStagedDiff(input.projectDir);
  const diffContent = getStagedDiffContent(input.projectDir);
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
