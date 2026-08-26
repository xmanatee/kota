import { resolveAgentHarness } from "#core/agent-harness/index.js";
import { type AgentRuntimeSelection, resolveAgentRuntime } from "#core/model/preset.js";
import type { WorkflowRuntimeDispatchState } from "./runtime-dispatch.js";
import type { WorkflowAgentRunContractSpec, WorkflowStep } from "./step-types.js";
import { resolveStaticWorkflowAgentRunContract } from "./steps/step-executor-agent-run-contract.js";
import type { WorkflowDefinition } from "./types.js";
import { validateWorkflowDefinitions, WorkflowDefinitionError } from "./validation.js";

export function compileDefinitions(
  state: Pick<WorkflowRuntimeDispatchState, "workflowInputs" | "scopeRoot" | "config" | "resolveAgentDef">,
): WorkflowDefinition[] {
  const runtime = resolveAgentRuntime(state.config);
  return validateWorkflowDefinitions(state.workflowInputs ?? [], state.scopeRoot, {
    defaultAgentHarness: runtime.harness,
    preset: runtime.preset,
    modelTiers: runtime.tiers,
    agentModels: state.config?.agentModels,
    resolveAgentDef: state.resolveAgentDef,
  });
}

function assertLoadableAgentContract(input: {
  resolveContract: () => WorkflowAgentRunContractSpec;
  workflowName: string;
  stepLabel: string;
  definitionPath: string;
}): void {
  try {
    const contract = input.resolveContract();
    const harness = resolveAgentHarness(contract.harness);
    resolveStaticWorkflowAgentRunContract({
      step: contract,
      harness,
      source: `workflow:${input.workflowName}/${input.stepLabel}`,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new WorkflowDefinitionError(
      `workflow "${input.workflowName}" ${input.stepLabel} resolved agent run contract is incompatible: ${detail}`,
      input.definitionPath,
    );
  }
}

function assertLoadableAgentContractsInSteps(
  steps: readonly WorkflowStep[],
  runtime: AgentRuntimeSelection,
  definition: Pick<WorkflowDefinition, "name" | "definitionPath">,
  path = "steps",
): void {
  for (const [index, step] of steps.entries()) {
    const stepLabel = `${path}[${index}]`;
    if (step.type === "agent") {
      assertLoadableAgentContract({
        resolveContract: () => step,
        workflowName: definition.name,
        stepLabel,
        definitionPath: definition.definitionPath,
      });
      for (const [checkIndex, check] of (step.repairLoop?.checks ?? []).entries()) {
        if (check.type !== "code" || check.resolveAgentContract === undefined) continue;
        assertLoadableAgentContract({
          resolveContract: () => check.resolveAgentContract!(step),
          workflowName: definition.name,
          stepLabel: `${stepLabel}.repairLoop.checks[${checkIndex}]`,
          definitionPath: definition.definitionPath,
        });
      }
      continue;
    }
    if (step.type === "code" && step.resolveAgentContract !== undefined) {
      assertLoadableAgentContract({
        resolveContract: () => step.resolveAgentContract!(runtime),
        workflowName: definition.name,
        stepLabel,
        definitionPath: definition.definitionPath,
      });
      continue;
    }
    if (step.type === "parallel" || step.type === "foreach") {
      assertLoadableAgentContractsInSteps(
        step.steps,
        runtime,
        definition,
        `${stepLabel}.steps`,
      );
      continue;
    }
    if (step.type === "branch") {
      assertLoadableAgentContractsInSteps(
        step.ifTrue,
        runtime,
        definition,
        `${stepLabel}.ifTrue`,
      );
      assertLoadableAgentContractsInSteps(
        step.ifFalse,
        runtime,
        definition,
        `${stepLabel}.ifFalse`,
      );
    }
  }
}

export function resolveDefinitions(
  state: Pick<WorkflowRuntimeDispatchState, "workflowInputs" | "scopeRoot" | "config">,
): WorkflowDefinition[] {
  const runtime = resolveAgentRuntime(state.config);
  const definitions = compileDefinitions(state);
  for (const definition of definitions) {
    assertLoadableAgentContractsInSteps(definition.steps, runtime, definition);
  }
  return definitions;
}

export function loadDefinitions(state: WorkflowRuntimeDispatchState): WorkflowDefinition[] {
  const validated = resolveDefinitions(state);
  state.definitionsLoadedAt = new Date().toISOString();
  return validated;
}
