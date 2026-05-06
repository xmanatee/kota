import type { RegisteredWorkflowDefinitionInput, WorkflowDefinition } from "./types.js";
import { assembleWorkflowDefinition } from "./validation-assembly.js";
import type { WorkflowValidationOptions } from "./validation-primitives.js";
import { validateRestartConstraints } from "./validation-restart.js";
import { validateWorkflowShape } from "./validation-shape.js";
import { validateStep } from "./validation-step-dispatch.js";
import { ensureUniqueStepIds } from "./validation-step-ids.js";
import { validateTriggerStepReferences } from "./validation-trigger-references.js";

export type { WorkflowValidationOptions } from "./validation-primitives.js";
export { WorkflowDefinitionError } from "./validation-primitives.js";

/**
 * Public registration entry point. Records the resolved relative
 * `definitionPath` alongside the rest of the registered definition so the
 * validator can quote it in error messages without re-resolving.
 */
export function registerWorkflowDefinition(
  definitionPath: string,
  definition: Omit<RegisteredWorkflowDefinitionInput, "definitionPath">,
): RegisteredWorkflowDefinitionInput {
  return {
    ...definition,
    definitionPath,
  };
}

/**
 * Thin orchestrator: walks each registered workflow input and delegates each
 * concern to a per-concern sibling. Each sibling owns one rule family
 * (top-level shape, step dispatch, step-id uniqueness, restart constraints,
 * trigger-step references, definition assembly). Adding a new rule should
 * extend the matching sibling rather than this dispatcher.
 */
export function validateWorkflowDefinitions(
  definitions: readonly RegisteredWorkflowDefinitionInput[],
  projectDir = process.cwd(),
  options: WorkflowValidationOptions = {},
): WorkflowDefinition[] {
  const seenWorkflowNames = new Map<string, RegisteredWorkflowDefinitionInput>();

  return definitions.map((definition, definitionIndex) => {
    const { definitionPath, name, moduleRoot, defaultAutonomyMode } =
      validateWorkflowShape(definition, definitionIndex, projectDir, seenWorkflowNames);

    const steps = definition.steps.map((step, stepIndex) =>
      validateStep(
        step,
        definitionPath,
        stepIndex,
        moduleRoot,
        defaultAutonomyMode,
        options,
      ),
    );

    ensureUniqueStepIds(steps, definitionPath);
    validateRestartConstraints(steps, definitionPath);
    validateTriggerStepReferences(name, steps, definitions, definitionPath);

    return assembleWorkflowDefinition(
      definition,
      definitionPath,
      name,
      moduleRoot,
      defaultAutonomyMode,
      steps,
    );
  });
}
