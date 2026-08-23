import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import {
  type CodeStepOutputValidator,
  expectStructuredOutput,
  type TypedCodeStepInput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import { stepCommitted, stepSucceeded } from "#modules/autonomy/shared.js";
import {
  claimNextQueueTask,
  DEFAULT_TASK_CLAIM_LEASE_MS,
  markTaskClaimPendingMerge,
  type QueueTaskClaimResult,
  releaseTaskClaim,
  type TaskClaimTerminalResult,
} from "#modules/autonomy/task-claims.js";
import type { BranchStepResult } from "./branch-per-task.js";
import { claimedTaskConsistencySucceeded } from "./claimed-task-consistency-step.js";
import { mergeGatePending, mergeGateSucceeded } from "./merge-gate-step.js";
import {
  BUILDER_RECOVERY_EVENT,
  claimPendingBuilderRecovery,
  unavailableBuilderRecoveryResult,
} from "./recovery-continuation.js";
import { workflowWorkspaceDir } from "./workspace.js";

type QueueInspection = {
  dirty: boolean;
  actionableCount: number;
  headSha: string;
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

function writeTaskClaimArtifact(runDirPath: string, result: QueueTaskClaimResult): void {
  mkdirSync(runDirPath, { recursive: true });
  writeFileSync(
    join(runDirPath, "task-claim.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf-8",
  );
}

export function createClaimTaskStep(
  inspectReadyQueue: TypedCodeStepInput<QueueInspection>,
): TypedCodeStepInput<QueueTaskClaimResult> {
  return typedCodeStep<QueueTaskClaimResult>({
    id: "claim-task",
    type: "code",
    rerunOnRetry: true,
    when: (ctx) => {
      if (ctx.trigger.event === "runtime.recovered") return false;
      if (ctx.trigger.event === BUILDER_RECOVERY_EVENT) return true;
      const { dirty, actionableCount } = inspectReadyQueue.outputRequired(ctx);
      return !dirty && actionableCount > 0;
    },
    validate: (raw) =>
      expectStructuredOutput<QueueTaskClaimResult>(raw, [
        "claimed",
        "taskId",
        "recoveryPath",
        "candidateCount",
        "skipped",
        "activeClaims",
      ]),
    run: (ctx) => {
      const recovery = claimPendingBuilderRecovery(ctx);
      if (recovery !== null) {
        writeTaskClaimArtifact(ctx.workflow.runDirPath, recovery);
        return recovery;
      }
      if (ctx.trigger.event === BUILDER_RECOVERY_EVENT) {
        const result = unavailableBuilderRecoveryResult(ctx.projectDir);
        writeTaskClaimArtifact(ctx.workflow.runDirPath, result);
        return result;
      }
      const workspaceDir = workflowWorkspaceDir(ctx);
      const queue = inspectReadyQueue.outputRequired(ctx);
      const result = claimNextQueueTask({
        projectDir: ctx.projectDir,
        runId: ctx.workflow.runId,
        workflowId: ctx.workflow.name,
        owner: `workflow:${ctx.workflow.name}`,
        workspaceDir,
        branch: readCurrentBranch(workspaceDir),
        baseCommit: queue.headSha,
        leaseMs: DEFAULT_TASK_CLAIM_LEASE_MS,
      });
      writeTaskClaimArtifact(ctx.workflow.runDirPath, result);
      return result;
    },
  });
}

export function createReleaseTaskClaimStep(
  claimTaskStep: TypedCodeStepInput<QueueTaskClaimResult>,
): TypedCodeStepInput<TaskClaimTerminalResult> {
  return typedCodeStep<TaskClaimTerminalResult>({
    id: "release-task-claim",
    type: "code",
    when: (ctx) => {
      if (!claimedTaskConsistencySucceeded(ctx)) return false;
      if (!stepCommitted("commit")(ctx)) return false;
      const branchInfo = ctx.stepOutputs["create-task-branch"] as BranchStepResult | undefined;
      return (branchInfo?.branchPerTask !== true || mergeGateSucceeded(ctx)) && claimTaskStep.output(ctx)?.claimed === true;
    },
    validate: validateTaskClaimTerminalResult,
    run: (ctx) => {
      const claim = claimTaskStep.outputRequired(ctx);
      if (!claim.taskId) throw new Error("Cannot release a task claim without a task id");
      return releaseTaskClaim({
        projectDir: ctx.projectDir,
        taskId: claim.taskId,
        runId: ctx.workflow.runId,
        workflowId: ctx.workflow.name,
        evidence: "builder workflow committed changes in the selected workspace",
      });
    },
  });
}

export function createMarkClaimPendingMergeStep(
  claimTaskStep: TypedCodeStepInput<QueueTaskClaimResult>,
): TypedCodeStepInput<TaskClaimTerminalResult> {
  return typedCodeStep<TaskClaimTerminalResult>({
    id: "mark-claim-pending-merge",
    type: "code",
    when: (ctx) =>
      (stepSucceeded("create-pr")(ctx) || mergeGatePending(ctx) !== undefined) &&
      claimTaskStep.output(ctx)?.claimed === true,
    validate: validateTaskClaimTerminalResult,
    run: (ctx) => {
      const claim = claimTaskStep.outputRequired(ctx);
      if (!claim.taskId) throw new Error("Cannot mark a task claim pending without a task id");
      const pr = ctx.stepOutputs["create-pr"] as { prUrl?: string } | undefined;
      const pending = mergeGatePending(ctx);
      return markTaskClaimPendingMerge({
        projectDir: ctx.projectDir,
        taskId: claim.taskId,
        runId: ctx.workflow.runId,
        workflowId: ctx.workflow.name,
        evidence: pending?.reason
          ? `builder branch is pending merge: ${pending.reason}`
          : pr?.prUrl
            ? `builder branch is pending merge at ${pr.prUrl}`
            : "builder branch is pending merge",
      });
    },
  });
}

const validateTaskClaimTerminalResult: CodeStepOutputValidator<TaskClaimTerminalResult> = (
  raw,
) =>
  expectStructuredOutput<TaskClaimTerminalResult>(raw, [
    "taskId",
    "changed",
    "recoveryStatus",
    "safeToRetry",
  ]);
