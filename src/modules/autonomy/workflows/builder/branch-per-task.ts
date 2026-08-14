import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import type { WorkflowCodeStepContext } from "#core/workflow/step-input-code.js";
import {
  type BranchStepResult,
  type CleanupMergedBranchesOperationInput,
  type CleanupResult,
  type CreatePullRequestOperationInput,
  type CreateTaskBranchOperationInput,
  cleanupMergedBranchesOperation,
  createPullRequestOperation,
  createTaskBranchOperation,
} from "./branch-per-task-operations.js";
import type { BuilderRunSummary } from "./run-summary.js";
import { workflowWorkspaceDir } from "./workspace.js";

export type {
  BranchStepResult,
  CleanupMergedBranchesOperationInput,
  CleanupResult,
  CreatePullRequestOperationInput,
  CreateTaskBranchOperationInput,
} from "./branch-per-task-operations.js";
export {
  cleanupMergedBranchesInWorker,
  createPullRequestInWorker,
  createTaskBranchInWorker,
} from "./branch-per-task-operations.js";

function getClaimedTaskId(ctx: WorkflowStepContext): string | null {
  const claim = ctx.stepOutputs["claim-task"];
  if (claim === null || typeof claim !== "object" || Array.isArray(claim)) {
    return null;
  }
  const taskId = (claim as { taskId?: string | null }).taskId;
  return typeof taskId === "string" && taskId ? taskId : null;
}

export function createTaskBranchOperationInput(
  ctx: WorkflowStepContext,
): CreateTaskBranchOperationInput {
  return {
    projectDir: ctx.projectDir,
    workspaceDir: workflowWorkspaceDir(ctx),
    runId: ctx.workflow.runId,
    claimedTaskId: getClaimedTaskId(ctx),
  };
}

export function createTaskBranch(
  ctx: WorkflowCodeStepContext,
): Promise<BranchStepResult> {
  return ctx.runBlocking(
    createTaskBranchOperation,
    createTaskBranchOperationInput(ctx),
  );
}

export function createPullRequestOperationInput(
  ctx: WorkflowStepContext,
): CreatePullRequestOperationInput {
  const summary = ctx.stepOutputs["write-run-summary"] as
    | BuilderRunSummary
    | undefined;
  return {
    projectDir: workflowWorkspaceDir(ctx),
    canonicalProjectDir: ctx.projectDir,
    runDir: ctx.workflow.runDir,
    branchInfo: ctx.stepOutputs["create-task-branch"] as BranchStepResult,
    ...(summary !== undefined ? { summary } : {}),
  };
}

export function createPullRequest(
  ctx: WorkflowCodeStepContext,
): Promise<{ prUrl: string }> {
  return ctx.runBlocking(
    createPullRequestOperation,
    createPullRequestOperationInput(ctx),
  );
}

export function cleanupMergedBranchesOperationInput(
  ctx: WorkflowStepContext,
): CleanupMergedBranchesOperationInput {
  const branchInfo = ctx.stepOutputs["create-task-branch"] as
    | BranchStepResult
    | undefined;
  return {
    projectDir: workflowWorkspaceDir(ctx),
    ...(branchInfo !== undefined ? { branchInfo } : {}),
  };
}

export function cleanupMergedBranches(
  ctx: WorkflowCodeStepContext,
): Promise<CleanupResult> {
  return ctx.runBlocking(
    cleanupMergedBranchesOperation,
    cleanupMergedBranchesOperationInput(ctx),
  );
}
