import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import {
  expectStructuredOutput,
  type TypedCodeStepInput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import { stepSucceeded } from "#modules/autonomy/shared.js";
import type { QueueTaskClaimResult } from "#modules/autonomy/task-claims.js";
import {
  type ClaimedTaskConsistencyResult,
  claimedTaskConsistencyOperation,
} from "./claimed-task-consistency-operation.js";
import { workflowWorkspaceDir } from "./workspace.js";

export const CLAIMED_TASK_CONSISTENCY_STEP_ID = "check-claimed-task-consistency";

export type { ClaimedTaskConsistencyResult } from "./claimed-task-consistency-operation.js";

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
      return ctx.runBlocking(claimedTaskConsistencyOperation, {
        projectDir: ctx.projectDir,
        workspaceDir,
        claimedTaskId,
        runId: ctx.workflow.runId,
        workflowName: ctx.workflow.name,
      });
    },
  });
}
