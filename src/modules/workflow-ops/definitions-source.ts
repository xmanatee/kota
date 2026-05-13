import { PRESET_ENV_VAR, resolvePreset } from "#core/model/preset.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { RegisteredWorkflowDefinitionInput, WorkflowDefinition } from "#core/workflow/types.js";
import { validateWorkflowDefinitions } from "#core/workflow/validation.js";

export function getWorkflowDefinitions(
  ctx: ModuleContext,
): RegisteredWorkflowDefinitionInput[] {
  return ctx.getContributedWorkflows();
}

export function getValidatedWorkflowDefinitions(
  ctx: ModuleContext,
  projectDir = ctx.cwd,
): WorkflowDefinition[] {
  const { preset } = resolvePreset({
    env: process.env[PRESET_ENV_VAR],
    config: ctx.config.defaultPreset,
  });
  return validateWorkflowDefinitions(getWorkflowDefinitions(ctx), projectDir, {
    defaultAgentHarness: ctx.config.defaultAgentHarness ?? preset.harness,
    preset,
    modelTiers: ctx.config.modelTiers,
  });
}
