import { resolveAgentRuntime } from "#core/model/preset.js";
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
  workspaceRoot = ctx.cwd,
): WorkflowDefinition[] {
  const runtime = resolveAgentRuntime(ctx.config);
  return validateWorkflowDefinitions(getWorkflowDefinitions(ctx), workspaceRoot, {
    defaultAgentHarness: runtime.harness,
    defaultAgentEffort: runtime.effort,
    preset: runtime.preset,
    modelTiers: runtime.tiers,
    agentModels: ctx.config.agentModels,
    resolveAgentDef: ctx.resolveAgentDef,
  });
}
