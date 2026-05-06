import type { WorkflowStep } from "./step-types.js";
import { WorkflowDefinitionError } from "./validation-primitives.js";

/**
 * Walks a workflow's step tree (including `parallel` children, `branch` arms,
 * and `foreach` bodies) and rejects any duplicate step ids. Step ids must be
 * globally unique within a workflow because runtime code addresses steps by id
 * across nested structures.
 */
export function ensureUniqueStepIds(
  steps: WorkflowStep[],
  definitionPath: string,
): void {
  const seenStepIds = new Set<string>();
  const collect = (flatSteps: WorkflowStep[]): void => {
    for (const step of flatSteps) {
      if (seenStepIds.has(step.id)) {
        throw new WorkflowDefinitionError(
          `duplicate step id "${step.id}"`,
          definitionPath,
        );
      }
      seenStepIds.add(step.id);
      if (step.type === "parallel") {
        for (const childStep of step.steps) {
          if (seenStepIds.has(childStep.id)) {
            throw new WorkflowDefinitionError(
              `duplicate step id "${childStep.id}"`,
              definitionPath,
            );
          }
          seenStepIds.add(childStep.id);
        }
      } else if (step.type === "branch") {
        collect(step.ifTrue);
        collect(step.ifFalse);
      } else if (step.type === "foreach") {
        for (const childStep of step.steps) {
          if (seenStepIds.has(childStep.id)) {
            throw new WorkflowDefinitionError(
              `duplicate step id "${childStep.id}"`,
              definitionPath,
            );
          }
          seenStepIds.add(childStep.id);
        }
      }
    }
  };
  collect(steps);
}
