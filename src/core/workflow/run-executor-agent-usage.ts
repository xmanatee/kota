import type { WorkflowStepResult } from "./run-types.js";
import type { WorkflowStep } from "./step-types.js";
import type { WorkflowDefinition } from "./types.js";

export function workflowUsesAgent(definition: WorkflowDefinition): boolean {
  return flattenSteps(definition.steps).some(stepUsesAgent);
}

export function runHasSuccessfulAgentExecution(
  definition: WorkflowDefinition,
  steps: readonly WorkflowStepResult[],
): boolean {
  const agentSteps = new Map(
    flattenSteps(definition.steps)
      .filter(stepUsesAgent)
      .map((step) => [step.id, step.type] as const),
  );
  return steps.some(
    (step) =>
      agentSteps.get(step.id) === step.type &&
      step.status === "success" &&
      step.reused !== true,
  );
}

function stepUsesAgent(step: WorkflowStep): boolean {
  return (
    step.type === "agent" ||
    (step.type === "code" && step.resolveAgentContract !== undefined)
  );
}

function flattenSteps(steps: readonly WorkflowStep[]): WorkflowStep[] {
  const flattened: WorkflowStep[] = [];
  for (const step of steps) {
    flattened.push(step);
    if (step.type === "parallel" || step.type === "foreach") {
      flattened.push(...flattenSteps(step.steps));
    } else if (step.type === "branch") {
      flattened.push(...flattenSteps(step.ifTrue), ...flattenSteps(step.ifFalse));
    }
  }
  return flattened;
}
