import type { WorkflowStepContext } from "#core/workflow/run-types.js";

export function workflowWorkspaceDir(
  ctx: Pick<WorkflowStepContext, "projectDir">,
): string {
  return ctx.projectDir;
}

export function builderAgentRunDir(
  ctx: Pick<
    WorkflowStepContext,
    "projectDir" | "runtimeResources" | "workflow"
  >,
): string {
  return ctx.runtimeResources?.agentRunDir ?? ctx.workflow.runDirPath;
}
