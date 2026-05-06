import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowStep,
  WorkflowTriggerStep,
} from "./types.js";
import { WorkflowDefinitionError } from "./validation-primitives.js";

/**
 * Validates how a workflow's `trigger` steps reference other workflows. Hard-
 * rejects self-referential triggers (which would form a recursive call), and
 * emits warnings when a trigger step references an unknown workflow (it may be
 * registered later by a module loaded in a different phase) or pairs
 * `waitFor: "queued"` with a child that declares an `outputSchema` (the queued
 * mode never observes the child's output).
 */
export function validateTriggerStepReferences(
  name: string,
  steps: WorkflowStep[],
  definitions: readonly RegisteredWorkflowDefinitionInput[],
  definitionPath: string,
): void {
  for (const step of steps) {
    if (step.type === "trigger") {
      const triggerStep = step as WorkflowTriggerStep;
      if (triggerStep.workflow === name) {
        throw new WorkflowDefinitionError(
          `workflow "${name}" has a trigger step "${step.id}" that references itself — this would create a recursive call`,
          definitionPath,
        );
      }
    }
  }

  const knownWorkflowNames = new Set(definitions.map((d) => d.name));
  const definitionsByName = new Map(definitions.map((d) => [d.name, d]));
  for (const step of steps) {
    if (step.type === "trigger") {
      const triggerStep = step as WorkflowTriggerStep;
      if (!knownWorkflowNames.has(triggerStep.workflow)) {
        console.warn(
          `[workflow "${name}"] trigger step "${step.id}" references unknown workflow "${triggerStep.workflow}" — it may be registered by a module loaded later`,
        );
      } else if (triggerStep.waitFor === "queued") {
        const childDef = definitionsByName.get(triggerStep.workflow);
        if (childDef?.outputSchema != null) {
          console.warn(
            `[workflow "${name}"] trigger step "${step.id}" fires "${triggerStep.workflow}" with waitFor: "queued" but "${triggerStep.workflow}" declares an outputSchema — use waitFor: "completed" to access the child workflow's output`,
          );
        }
      }
    }
  }
}
