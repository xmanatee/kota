import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowDefinition,
  WorkflowRestartStep,
  WorkflowStep,
  WorkflowStepInput,
  WorkflowTrigger,
  WorkflowTriggerInput,
} from "./types.js";
import {
  expectName,
  expectNonEmptyString,
  expectOptionalBoolean,
  expectOptionalInteger,
  expectOptionalScalarFilter,
  expectOptionalString,
  expectRelativePath,
  WorkflowDefinitionError,
} from "./validation-primitives.js";
import {
  validateAgentStep,
  validateCodeStep,
  validateEmitStep,
  validateRestartStep,
  validateToolStep,
} from "./validation-steps.js";

export { WorkflowDefinitionError } from "./validation-primitives.js";

function validateTrigger(
  trigger: WorkflowTriggerInput,
  definitionPath: string,
  index: number,
): WorkflowTrigger {
  const event = expectNonEmptyString(
    trigger?.event,
    `triggers[${index}].event`,
    definitionPath,
  );
  return {
    event,
    filter: expectOptionalScalarFilter(
      trigger.filter,
      `triggers[${index}].filter`,
      definitionPath,
    ),
    cooldownMs:
      expectOptionalInteger(
        trigger.cooldownMs,
        `triggers[${index}].cooldownMs`,
        definitionPath,
        0,
      ) ?? 0,
  };
}

function validateStep(
  step: WorkflowStepInput,
  definitionPath: string,
  index: number,
  projectDir: string,
): WorkflowStep {
  if (!step || typeof step !== "object") {
    throw new WorkflowDefinitionError(
      `steps[${index}] must be an object`,
      definitionPath,
    );
  }

  if (step.type === "tool") return validateToolStep(step, definitionPath, index);
  if (step.type === "agent") {
    return validateAgentStep(step, definitionPath, index, projectDir);
  }
  if (step.type === "emit") return validateEmitStep(step, definitionPath, index);
  if (step.type === "restart") {
    return validateRestartStep(step, definitionPath, index);
  }
  if (step.type === "code") return validateCodeStep(step, definitionPath, index);

  throw new WorkflowDefinitionError(
    `steps[${index}].type must be "tool", "agent", "emit", "restart", or "code"`,
    definitionPath,
  );
}

export function registerWorkflowDefinition(
  definitionPath: string,
  definition: Omit<RegisteredWorkflowDefinitionInput, "definitionPath">,
): RegisteredWorkflowDefinitionInput {
  return {
    ...definition,
    definitionPath,
  };
}

export function validateWorkflowDefinitions(
  definitions: readonly RegisteredWorkflowDefinitionInput[],
  projectDir = process.cwd(),
): WorkflowDefinition[] {
  const seenWorkflowNames = new Set<string>();

  return definitions.map((definition, definitionIndex) => {
    const definitionPath = expectRelativePath(
      definition.definitionPath,
      `definitions[${definitionIndex}].definitionPath`,
      `<workflow-${definitionIndex}>`,
    );
    const name = expectName(definition.name, "name", definitionPath);
    if (seenWorkflowNames.has(name)) {
      throw new WorkflowDefinitionError(
        `duplicate workflow name "${name}"`,
        definitionPath,
      );
    }
    seenWorkflowNames.add(name);

    if (!Array.isArray(definition.triggers) || definition.triggers.length === 0) {
      throw new WorkflowDefinitionError(
        "triggers must be a non-empty array",
        definitionPath,
      );
    }
    if (!Array.isArray(definition.steps) || definition.steps.length === 0) {
      throw new WorkflowDefinitionError(
        "steps must be a non-empty array",
        definitionPath,
      );
    }

    const steps = definition.steps.map((step, stepIndex) =>
      validateStep(step, definitionPath, stepIndex, projectDir),
    );
    const seenStepIds = new Set<string>();
    for (const step of steps) {
      if (seenStepIds.has(step.id)) {
        throw new WorkflowDefinitionError(
          `duplicate step id "${step.id}"`,
          definitionPath,
        );
      }
      seenStepIds.add(step.id);
    }

    const restartSteps = steps.filter(
      (step): step is WorkflowRestartStep => step.type === "restart",
    );
    if (restartSteps.length > 1) {
      throw new WorkflowDefinitionError(
        "workflows may contain at most one restart step",
        definitionPath,
      );
    }
    if (restartSteps.length === 1) {
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
        if (requiredStep.type !== "tool" && requiredStep.type !== "code") {
          throw new WorkflowDefinitionError(
            `restart step "${restartStep.id}" may only require tool or code steps, got "${requiredStep.type}" for "${requiredId}"`,
            definitionPath,
          );
        }
      }
    }

    return {
      name,
      description: expectOptionalString(
        definition.description,
        "description",
        definitionPath,
      ),
      enabled: expectOptionalBoolean(
        definition.enabled,
        "enabled",
        definitionPath,
      ) ?? true,
      definitionPath,
      triggers: definition.triggers.map((trigger, triggerIndex) =>
        validateTrigger(trigger, definitionPath, triggerIndex),
      ),
      steps,
    };
  });
}
