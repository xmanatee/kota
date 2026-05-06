import type { WorkflowRestartStep, WorkflowStep } from "./types.js";
import { WorkflowDefinitionError } from "./validation-primitives.js";

/**
 * Restart-step constraints: at most one restart step per workflow, the restart
 * step must be the final step, every required-step id must resolve to an
 * earlier step in the same workflow, and required steps must be of a type that
 * the restart machinery can re-run safely (`tool`, `code`, or `parallel`).
 */
export function validateRestartConstraints(
  steps: WorkflowStep[],
  definitionPath: string,
): void {
  const restartSteps = steps.filter(
    (step): step is WorkflowRestartStep => step.type === "restart",
  );
  if (restartSteps.length > 1) {
    throw new WorkflowDefinitionError(
      "workflows may contain at most one restart step",
      definitionPath,
    );
  }
  if (restartSteps.length === 0) return;

  const restartStep = restartSteps[0];
  const restartIndex = steps.findIndex((step) => step.id === restartStep.id);
  if (restartIndex !== steps.length - 1) {
    throw new WorkflowDefinitionError(
      `restart step "${restartStep.id}" must be the final step`,
      definitionPath,
    );
  }
  if (restartStep.requires.length === 0) {
    throw new WorkflowDefinitionError(
      `restart step "${restartStep.id}" must declare at least one required verification step`,
      definitionPath,
    );
  }

  const seenRequiredIds = new Set<string>();
  for (const requiredId of restartStep.requires) {
    if (seenRequiredIds.has(requiredId)) {
      throw new WorkflowDefinitionError(
        `restart step "${restartStep.id}" references duplicate required step "${requiredId}"`,
        definitionPath,
      );
    }
    seenRequiredIds.add(requiredId);

    const requiredIndex = steps.findIndex((step) => step.id === requiredId);
    if (requiredIndex < 0) {
      throw new WorkflowDefinitionError(
        `restart step "${restartStep.id}" references unknown step "${requiredId}"`,
        definitionPath,
      );
    }
    if (requiredIndex >= restartIndex) {
      throw new WorkflowDefinitionError(
        `restart step "${restartStep.id}" requires step "${requiredId}" to run before restart`,
        definitionPath,
      );
    }

    const requiredStep = steps[requiredIndex];
    if (
      requiredStep.type !== "tool" &&
      requiredStep.type !== "code" &&
      requiredStep.type !== "parallel"
    ) {
      throw new WorkflowDefinitionError(
        `restart step "${restartStep.id}" may only require tool, code, or parallel steps, got "${requiredStep.type}" for "${requiredId}"`,
        definitionPath,
      );
    }
  }
}
