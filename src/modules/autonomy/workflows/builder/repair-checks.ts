import { withWorkflowBlockingOperation } from "#core/workflow/blocking-operation-context.js";
import type { WorkflowRepairCheck } from "#core/workflow/run-types.js";
import { createCriticCheck } from "#modules/autonomy/critic.js";
import { runBuilderRepairCheck } from "./blocking-operations.js";
import { readBuilderTaskReviewContract } from "./task-contract.js";
import { workflowWorkspaceDir } from "./workspace.js";

/**
 * Universal builder checks protect task authority and independent review only.
 * The builder chooses behavior-specific proof; repository publication, write
 * scope, trust, secrets, and integration safety are enforced by their runtime
 * owners outside this repair catalog.
 */
export function builderRepairChecks(): WorkflowRepairCheck[] {
  return [
    {
      id: "target-task-resolved",
      type: "code" as const,
      run: (ctx) =>
        runBuilderRepairCheck(withWorkflowBlockingOperation(ctx), {
          workspaceRoot: workflowWorkspaceDir(ctx),
          taskId: String(ctx.trigger.payload.taskId),
        }),
    },
    createCriticCheck({
      resolveTaskReviewContract: readBuilderTaskReviewContract,
    }),
  ];
}
