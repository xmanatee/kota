import type { WorkflowStepResult } from "./run-types.js";
import type { WorkflowStep } from "./step-types.js";
import type { WorkflowDefinition } from "./types.js";

export function workflowUsesAgent(definition: WorkflowDefinition): boolean {
  return definition.steps.some(stepUsesAgent);
}

export function runHasSuccessfulAgentExecution(
  steps: readonly WorkflowStepResult[],
): boolean {
  return steps.some(
    (step) =>
      step.type === "agent" &&
      step.status === "success" &&
      step.reused !== true,
  );
}

function stepUsesAgent(step: WorkflowStep): boolean {
  if (step.type === "agent") return true;
  if (step.type === "parallel" || step.type === "foreach") {
    return step.steps.some((innerStep) => innerStep.type === "agent");
  }
  if (step.type === "branch") {
    return step.ifTrue.some(stepUsesAgent) || step.ifFalse.some(stepUsesAgent);
  }
  return false;
}
