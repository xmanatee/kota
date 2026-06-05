import { resolveAgentHarness } from "#core/agent-harness/index.js";
import { resolvePreset } from "#core/model/preset.js";
import type { WorkflowRuntimeDispatchState } from "./runtime-dispatch.js";
import type { WorkflowStep } from "./step-types.js";
import type { WorkflowDefinition } from "./types.js";
import { validateWorkflowDefinitions } from "./validation.js";

export function compileDefinitions(
  state: Pick<WorkflowRuntimeDispatchState, "workflowInputs" | "projectDir" | "config" | "resolveAgentDef">,
): WorkflowDefinition[] {
  const { preset } = resolvePreset({
    env: process.env.KOTA_PRESET,
    config: state.config?.defaultPreset,
  });
  return validateWorkflowDefinitions(state.workflowInputs ?? [], state.projectDir, {
    defaultAgentHarness: state.config?.defaultAgentHarness ?? preset.harness,
    preset,
    modelTiers: state.config?.modelTiers,
    resolveAgentDef: state.resolveAgentDef,
  });
}

function assertRegisteredHarnessesInSteps(steps: readonly WorkflowStep[]): void {
  for (const step of steps) {
    if (step.type === "agent") {
      resolveAgentHarness(step.harness);
      continue;
    }
    if (step.type === "parallel" || step.type === "foreach") {
      assertRegisteredHarnessesInSteps(step.steps);
      continue;
    }
    if (step.type === "branch") {
      assertRegisteredHarnessesInSteps(step.ifTrue);
      assertRegisteredHarnessesInSteps(step.ifFalse);
    }
  }
}

export function resolveDefinitions(
  state: Pick<WorkflowRuntimeDispatchState, "workflowInputs" | "projectDir" | "config">,
): WorkflowDefinition[] {
  const definitions = compileDefinitions(state);
  for (const definition of definitions) {
    assertRegisteredHarnessesInSteps(definition.steps);
  }
  return definitions;
}

export function loadDefinitions(state: WorkflowRuntimeDispatchState): WorkflowDefinition[] {
  const validated = resolveDefinitions(state);
  state.store.setDefinitionsLoadedAt(new Date().toISOString());
  return validated;
}
