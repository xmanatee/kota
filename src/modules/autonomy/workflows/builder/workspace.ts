import type { WorkflowStepContext } from "#core/workflow/run-types.js";

export function workflowWorkspaceDir(
  ctx: Pick<WorkflowStepContext, "workspaceRoot">,
): string {
  return ctx.workspaceRoot;
}
