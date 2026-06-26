import type { WorkflowStepContext } from "#core/workflow/run-types.js";

export function workflowWorkspaceDir(
  ctx: Pick<WorkflowStepContext, "projectDir" | "workspaceDir">,
): string {
  return ctx.workspaceDir ?? ctx.projectDir;
}
