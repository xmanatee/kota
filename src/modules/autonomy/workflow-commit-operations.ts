import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  checkCommitStageable,
  commitWorkflowChanges,
  type WorkflowCommitPathPolicy,
} from "#modules/autonomy/commit.js";
import type { CommitResult } from "#modules/autonomy/commit-result.js";
import {
  checkCommitMessageExists,
  checkNoScratchArtifacts,
} from "#modules/autonomy/shared.js";

export type WorkflowCommitOperationInput = {
  projectDir: string;
  runDirPath: string;
  policy?: WorkflowCommitPathPolicy;
};

export type WorkflowCommitValidationResult = {
  scratchArtifacts: string;
  commitMessage: string;
  commitStage: string;
};

export type WorkflowCommitCheckInput =
  | {
      kind: "scratch-artifacts";
      projectDir: string;
    }
  | {
      kind: "commit-message";
      projectDir: string;
      runDirPath: string;
    }
  | {
      kind: "commit-stageable";
      projectDir: string;
      policy?: WorkflowCommitPathPolicy;
    };

export function runWorkflowCommitCheckInWorker(
  input: WorkflowCommitCheckInput,
): string {
  if (input.kind === "scratch-artifacts") {
    return checkNoScratchArtifacts(input.projectDir);
  }
  if (input.kind === "commit-message") {
    return checkCommitMessageExists(input.runDirPath, input.projectDir);
  }
  return input.policy === undefined
    ? checkCommitStageable(input.projectDir)
    : checkCommitStageable(input.projectDir, input.policy);
}

export function validateWorkflowCommitInWorker(
  input: WorkflowCommitOperationInput,
): WorkflowCommitValidationResult {
  const commitStage = input.policy === undefined
    ? checkCommitStageable(input.projectDir)
    : checkCommitStageable(input.projectDir, input.policy);
  return {
    scratchArtifacts: checkNoScratchArtifacts(input.projectDir),
    commitMessage: checkCommitMessageExists(input.runDirPath, input.projectDir),
    commitStage,
  };
}

export function commitWorkflowChangesInWorker(
  input: WorkflowCommitOperationInput,
): CommitResult {
  return input.policy === undefined
    ? commitWorkflowChanges(input.projectDir, input.runDirPath)
    : commitWorkflowChanges(input.projectDir, input.runDirPath, input.policy);
}

export const workflowCommitCheckOperation = defineWorkflowBlockingOperation<
  WorkflowCommitCheckInput,
  string
>(import.meta.url, "runWorkflowCommitCheckInWorker");

export const workflowCommitValidationOperation =
  defineWorkflowBlockingOperation<
    WorkflowCommitOperationInput,
    WorkflowCommitValidationResult
  >(import.meta.url, "validateWorkflowCommitInWorker");

export const workflowCommitOperation = defineWorkflowBlockingOperation<
  WorkflowCommitOperationInput,
  CommitResult
>(import.meta.url, "commitWorkflowChangesInWorker");
