import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { tryListWorkflowMutatedPaths } from "#core/workflow/steps/agent-write-scope.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import { SECURITY_REVIEW_DUE_EVENT } from "./due-check.js";
import {
  createOrUpdateSecurityFindingTasks,
  SECURITY_REVIEW_MAX_CANDIDATES,
  SECURITY_REVIEW_MAX_CANDIDATES_PER_SURFACE,
  type SecurityFindingTaskResult,
  type SecurityRevalidationOutput,
  type SecurityReviewCandidatePacket,
  scanAndWriteSecurityReviewCandidates,
  securityReviewDueTargetsFromPayload,
} from "./security-review.js";

export type SecurityReviewMutationBaseline = {
  preExistingMutatedPaths: string[];
};

type SecurityReviewScanOperationInput = {
  projectDir: string;
  runDirPath: string;
  trigger: Pick<WorkflowRunTrigger, "event" | "payload">;
};

export function captureSecurityReviewMutationBaseline(
  input: { projectDir: string },
): SecurityReviewMutationBaseline {
  return {
    preExistingMutatedPaths:
      tryListWorkflowMutatedPaths(input.projectDir) ?? [],
  };
}

export function scanSecurityReviewCandidatesInWorker(
  input: SecurityReviewScanOperationInput,
): SecurityReviewCandidatePacket {
  return scanAndWriteSecurityReviewCandidates(
    input.projectDir,
    input.runDirPath,
    {
      maxCandidates: SECURITY_REVIEW_MAX_CANDIDATES,
      maxCandidatesPerSurface: SECURITY_REVIEW_MAX_CANDIDATES_PER_SURFACE,
      dueTargets:
        input.trigger.event === SECURITY_REVIEW_DUE_EVENT
          ? securityReviewDueTargetsFromPayload(
              input.projectDir,
              input.trigger.payload,
            )
          : [],
    },
  );
}

export function createSecurityFindingTasksInWorker(input: {
  projectDir: string;
  runId: string;
  findings: SecurityRevalidationOutput["findings"];
}): SecurityFindingTaskResult {
  return createOrUpdateSecurityFindingTasks(input.projectDir, {
    runId: input.runId,
    findings: input.findings,
  });
}

export const securityReviewMutationBaselineOperation =
  defineWorkflowBlockingOperation<
    { projectDir: string },
    SecurityReviewMutationBaseline
  >(import.meta.url, "captureSecurityReviewMutationBaseline");

export const securityReviewCandidateScanOperation =
  defineWorkflowBlockingOperation<
    SecurityReviewScanOperationInput,
    SecurityReviewCandidatePacket
  >(import.meta.url, "scanSecurityReviewCandidatesInWorker");

export const createSecurityFindingTasksOperation =
  defineWorkflowBlockingOperation<
    {
      projectDir: string;
      runId: string;
      findings: SecurityRevalidationOutput["findings"];
    },
    SecurityFindingTaskResult
  >(import.meta.url, "createSecurityFindingTasksInWorker");
