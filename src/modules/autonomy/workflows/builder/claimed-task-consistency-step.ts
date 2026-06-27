import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import {
  expectStructuredOutput,
  type TypedCodeStepInput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import { stepSucceeded } from "#modules/autonomy/shared.js";
import type { QueueTaskClaimResult } from "#modules/autonomy/task-claims.js";
import type { BuilderRunSummary } from "./run-summary.js";

export const CLAIMED_TASK_CONSISTENCY_STEP_ID = "check-claimed-task-consistency";

export type ClaimedTaskConsistencyResult = {
  matched: true;
  taskId: string;
  claimedTaskId: string;
  summaryTaskId: string;
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
    when: stepSucceeded("write-run-summary"),
    validate: (raw) =>
      expectStructuredOutput<ClaimedTaskConsistencyResult>(raw, [
        "matched",
        "taskId",
        "claimedTaskId",
        "summaryTaskId",
      ]),
    run: (ctx) => {
      const claim = claimTaskStep.outputRequired(ctx);
      const claimedTaskId = nonEmptyTaskId(claim.taskId);
      if (claim.claimed !== true || claimedTaskId === null) {
        throw new Error("Builder cannot validate completion without a claimed task id");
      }

      const summary = ctx.stepOutputs["write-run-summary"] as BuilderRunSummary | undefined;
      const summaryTaskId = nonEmptyTaskId(summary?.taskId);
      if (summaryTaskId === null) {
        throw new Error(
          `Builder claimed ${claimedTaskId} but run-summary did not identify a completed task`,
        );
      }
      if (summaryTaskId !== claimedTaskId) {
        throw new Error(
          `Builder claimed ${claimedTaskId} but run-summary identified ${summaryTaskId}; ` +
            "refusing to emit workflow.build.committed or release the task claim",
        );
      }

      return {
        matched: true,
        taskId: claimedTaskId,
        claimedTaskId,
        summaryTaskId,
      };
    },
  });
}
