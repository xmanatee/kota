import type { ModuleContext } from "../../module-types.js";
import type { RegisteredWorkflowDefinitionInput, WorkflowDefinition } from "../../workflow/types.js";
import { validateWorkflowDefinitions } from "../../workflow/validation.js";

export function getWorkflowDefinitions(
  ctx: ModuleContext,
): RegisteredWorkflowDefinitionInput[] {
  return ctx.getContributedWorkflows();
}

export function getValidatedWorkflowDefinitions(
  ctx: ModuleContext,
  projectDir = process.cwd(),
): WorkflowDefinition[] {
  return validateWorkflowDefinitions(getWorkflowDefinitions(ctx), projectDir);
}
