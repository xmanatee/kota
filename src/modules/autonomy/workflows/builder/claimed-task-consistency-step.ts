import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import {
  expectStructuredOutput,
  type TypedCodeStepInput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import { listWorkflowMutatedPaths } from "#core/workflow/steps/agent-write-scope.js";
import { stepSucceeded } from "#modules/autonomy/shared.js";
import {
  type QueueTaskClaimResult,
  releaseTaskClaim,
} from "#modules/autonomy/task-claims.js";
import { findTerminalTaskInChangedFiles } from "./run-summary.js";
import { workflowWorkspaceDir } from "./workspace.js";

export const CLAIMED_TASK_CONSISTENCY_STEP_ID = "check-claimed-task-consistency";

export type ClaimedTaskConsistencyResult = {
  matched: true;
  taskId: string;
  claimedTaskId: string;
  completedTaskId: string;
};

function nonEmptyTaskId(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function claimedTaskConsistencySucceeded(ctx: WorkflowStepContext): boolean {
  return ctx.stepResults[CLAIMED_TASK_CONSISTENCY_STEP_ID]?.status === "success";
}

export function createClaimedTaskConsistencyStep(
  claimTaskStep: TypedCodeStepInput<QueueTaskClaimResult>,
): TypedCodeStepInput<ClaimedTaskConsistencyResult> {
  return typedCodeStep<ClaimedTaskConsistencyResult>({
    id: CLAIMED_TASK_CONSISTENCY_STEP_ID,
    type: "code",
    when: stepSucceeded("create-task-branch"),
    validate: (raw) =>
      expectStructuredOutput<ClaimedTaskConsistencyResult>(raw, [
        "matched",
        "taskId",
        "claimedTaskId",
        "completedTaskId",
      ]),
    run: (ctx) => {
      const claim = claimTaskStep.outputRequired(ctx);
      const claimedTaskId = nonEmptyTaskId(claim.taskId);
      if (claim.claimed !== true || claimedTaskId === null) {
        throw new Error("Builder cannot validate completion without a claimed task id");
      }

      const workspaceDir = workflowWorkspaceDir(ctx);
      const task = findTerminalTaskInChangedFiles(
        workspaceDir,
        listWorkflowMutatedPaths(workspaceDir),
      );
      const completedTaskId = nonEmptyTaskId(task.taskId);
      if (completedTaskId === null) {
        releaseMismatchedClaim(ctx, claimedTaskId, "no terminal task in the pre-commit set");
        throw new Error(
          `Builder claimed ${claimedTaskId} but the pre-commit set did not identify a completed task; ` +
            "released the task claim for retry and refusing to commit",
        );
      }
      if (completedTaskId !== claimedTaskId) {
        releaseMismatchedClaim(
          ctx,
          claimedTaskId,
          `pre-commit set identified ${completedTaskId}`,
        );
        throw new Error(
          `Builder claimed ${claimedTaskId} but the pre-commit set identified ${completedTaskId}; ` +
            "released the task claim for retry and refusing to commit or emit workflow.build.committed",
        );
      }

      return {
        matched: true,
        taskId: claimedTaskId,
        claimedTaskId,
        completedTaskId,
      };
    },
  });
}

function releaseMismatchedClaim(
  ctx: WorkflowStepContext,
  claimedTaskId: string,
  reason: string,
): void {
  const release = releaseTaskClaim({
    projectDir: ctx.projectDir,
    taskId: claimedTaskId,
    runId: ctx.workflow.runId,
    workflowId: ctx.workflow.name,
    evidence: `builder claimed-task consistency failed before commit: ${reason}`,
  });
  if (!release.safeToRetry) {
    throw new Error(
      `Builder claimed ${claimedTaskId} but could not release the task claim after ${reason}: ` +
        (release.reason ?? release.recoveryStatus),
    );
  }
}
