import { spawnSync } from "node:child_process";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import {
  claimNextQueueTask,
  markTaskClaimPendingMerge,
  type QueueTaskClaimResult,
  releaseTaskClaim,
  type TaskClaimTerminalResult,
} from "#modules/autonomy/task-claims.js";
import {
  claimPendingBuilderRecovery,
  unavailableBuilderRecoveryResult,
} from "./recovery-continuation.js";

type BuilderTaskClaimMutationInput = {
  projectDir: string;
  taskId: string;
  runId: string;
  workflowId: string;
  evidence: string;
};

type BuilderRecoveryClaimInput = {
  projectDir: string;
  trigger: WorkflowRunTrigger;
  runId: string;
  workflowName: string;
  runDir: string;
  runDirPath: string;
};

type ClaimQueueTaskOperationInput = {
  projectDir: string;
  runId: string;
  workflowId: string;
  owner: string;
  workspaceDir: string;
  baseCommit: string;
  leaseMs: number;
};

function readCurrentBranch(repoDir: string): string {
  const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf-8",
    stdio: "pipe",
  });
  if (result.status !== 0) return "unknown";
  return result.stdout.trim() || "unknown";
}

export function claimQueueTaskInWorker(
  input: ClaimQueueTaskOperationInput,
): QueueTaskClaimResult {
  return claimNextQueueTask({
    ...input,
    branch: readCurrentBranch(input.workspaceDir),
  });
}

export function claimBuilderRecoveryInWorker(
  input: BuilderRecoveryClaimInput,
): QueueTaskClaimResult {
  return (
    claimPendingBuilderRecovery({
      projectDir: input.projectDir,
      trigger: input.trigger,
      workflow: {
        name: input.workflowName,
        definitionPath: "worker:builder-recovery-claim",
        runId: input.runId,
        runDir: input.runDir,
        runDirPath: input.runDirPath,
      },
    }) ?? unavailableBuilderRecoveryResult(input.projectDir)
  );
}

export function releaseBuilderTaskClaimInWorker(
  input: BuilderTaskClaimMutationInput,
): TaskClaimTerminalResult {
  return releaseTaskClaim(input);
}

export function markBuilderTaskClaimPendingMergeInWorker(
  input: BuilderTaskClaimMutationInput,
): TaskClaimTerminalResult {
  return markTaskClaimPendingMerge(input);
}

export const claimBuilderRecoveryOperation = defineWorkflowBlockingOperation<
  BuilderRecoveryClaimInput,
  QueueTaskClaimResult
>(import.meta.url, "claimBuilderRecoveryInWorker");

export const claimQueueTaskOperation = defineWorkflowBlockingOperation<
  ClaimQueueTaskOperationInput,
  QueueTaskClaimResult
>(import.meta.url, "claimQueueTaskInWorker");

export const releaseBuilderTaskClaimOperation =
  defineWorkflowBlockingOperation<
    BuilderTaskClaimMutationInput,
    TaskClaimTerminalResult
  >(import.meta.url, "releaseBuilderTaskClaimInWorker");

export const markBuilderTaskClaimPendingMergeOperation =
  defineWorkflowBlockingOperation<
    BuilderTaskClaimMutationInput,
    TaskClaimTerminalResult
  >(import.meta.url, "markBuilderTaskClaimPendingMergeInWorker");
