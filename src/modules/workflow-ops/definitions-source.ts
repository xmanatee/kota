import type { ModuleContext } from "../../core/modules/module-types.js";
import type { RegisteredWorkflowDefinitionInput, WorkflowDefinition } from "../../core/workflow/types.js";
import { validateWorkflowDefinitions } from "../../core/workflow/validation.js";

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
