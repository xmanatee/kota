import { resolveAgentHarness } from "#core/agent-harness/index.js";
import type { WorkflowRuntimeDispatchState } from "./runtime-dispatch.js";
import type { WorkflowStep } from "./step-types.js";
import type { WorkflowDefinition } from "./types.js";
import { validateWorkflowDefinitions } from "./validation.js";

export function compileDefinitions(
  state: Pick<WorkflowRuntimeDispatchState, "workflowInputs" | "projectDir" | "config">,
): WorkflowDefinition[] {
  return validateWorkflowDefinitions(state.workflowInputs ?? [], state.projectDir, {
    defaultAgentHarness: state.config?.defaultAgentHarness,
    modelTiers: state.config?.modelTiers,
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
