import type { ExtensionContext } from "../../extension-types.js";
import type { RegisteredWorkflowDefinitionInput, WorkflowDefinition } from "../../workflow/types.js";
import { validateWorkflowDefinitions } from "../../workflow/validation.js";

export function getWorkflowDefinitions(
  ctx: ExtensionContext,
): RegisteredWorkflowDefinitionInput[] {
  return ctx.getContributedWorkflows();
}

export function getValidatedWorkflowDefinitions(
  ctx: ExtensionContext,
  projectDir = process.cwd(),
): WorkflowDefinition[] {
  return validateWorkflowDefinitions(getWorkflowDefinitions(ctx), projectDir);
}
