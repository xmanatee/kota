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
import { findTerminalTasksInChangedFiles } from "./run-summary.js";
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
      const terminalTasks = findTerminalTasksInChangedFiles(
        workspaceDir,
        listWorkflowMutatedPaths(workspaceDir),
      );
      const completedTasks = terminalTasks.some((task) => task.becameTerminal)
        ? terminalTasks.filter((task) => task.becameTerminal)
        : terminalTasks;
      if (completedTasks.length === 0) {
        releaseMismatchedClaim(ctx, claimedTaskId, "no terminal task in the pre-commit set");
        throw new Error(
          `Builder claimed ${claimedTaskId} but the pre-commit set did not identify a completed task; ` +
            "released the task claim for retry and refusing to commit",
        );
      }
      const matchingTask = completedTasks.find((task) => task.taskId === claimedTaskId);
      if (matchingTask === undefined) {
        const completedTaskId = completedTasks[0]?.taskId ?? "unknown";
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
      const otherCompletedTasks = completedTasks.filter((task) => task.taskId !== claimedTaskId);
      if (otherCompletedTasks.length > 0) {
        const otherTaskIds = otherCompletedTasks.map((task) => task.taskId).join(", ");
        releaseMismatchedClaim(
          ctx,
          claimedTaskId,
          `pre-commit set also completed ${otherTaskIds}`,
        );
        throw new Error(
          `Builder claimed ${claimedTaskId} but the pre-commit set also completed ${otherTaskIds}; ` +
            "released the task claim for retry and refusing to commit or emit workflow.build.committed",
        );
      }

      return {
        matched: true,
        taskId: claimedTaskId,
        claimedTaskId,
        completedTaskId: matchingTask.taskId,
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
