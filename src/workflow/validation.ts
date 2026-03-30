import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowDefinition,
  WorkflowParallelGroupInput,
  WorkflowRestartStep,
  WorkflowStep,
  WorkflowStepInput,
} from "./types.js";
import {
  expectName,
  expectOptionalBoolean,
  expectOptionalInteger,
  expectOptionalPositiveNumber,
  expectOptionalString,
  expectRelativePath,
  WorkflowDefinitionError,
} from "./validation-primitives.js";
import {
  validateAgentStep,
  validateCodeStep,
  validateEmitStep,
  validateParallelGroup,
  validateRestartStep,
  validateToolStep,
} from "./validation-steps.js";
import { validateTrigger } from "./validation-trigger.js";

export { WorkflowDefinitionError } from "./validation-primitives.js";

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
  if (step.type === "parallel") {
    return validateParallelGroup(step as WorkflowParallelGroupInput, definitionPath, index);
  }

  throw new WorkflowDefinitionError(
    `steps[${index}].type must be "tool", "agent", "emit", "restart", "code", or "parallel"`,
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
      }
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
      runTimeoutMs: expectOptionalInteger(
        definition.runTimeoutMs,
        "runTimeoutMs",
        definitionPath,
        1,
      ),
      dailyBudgetUsd: expectOptionalPositiveNumber(
        definition.dailyBudgetUsd,
        "dailyBudgetUsd",
        definitionPath,
      ),
      costLimitUsd: expectOptionalPositiveNumber(
        definition.costLimitUsd,
        "costLimitUsd",
        definitionPath,
      ),
      concurrencyGroup: expectOptionalString(
        definition.concurrencyGroup,
        "concurrencyGroup",
        definitionPath,
      ),
      definitionPath,
      triggers: (() => {
        const triggers = definition.triggers.map((trigger, triggerIndex) =>
          validateTrigger(trigger, definitionPath, triggerIndex),
        );
        for (const trigger of triggers) {
          if (trigger.event === "workflow.completed") {
            const workflowFilter = trigger.filter?.workflow;
            if (!workflowFilter) {
              throw new WorkflowDefinitionError(
                `workflow "${name}" has a "workflow.completed" trigger with no "workflow" filter — ` +
                  `this would trigger after the workflow's own completion and create an infinite loop. ` +
                  `Add filter: { workflow: [...other workflow names...] } that excludes "${name}".`,
                definitionPath,
              );
            }
            const filterValues = Array.isArray(workflowFilter)
              ? workflowFilter
              : [workflowFilter];
            if (filterValues.includes(name)) {
              throw new WorkflowDefinitionError(
                `workflow "${name}" has a "workflow.completed" trigger with a filter that includes ` +
                  `its own name — this would trigger after its own completion and create an infinite loop.`,
                definitionPath,
              );
            }
          }
        }
        return triggers;
      })(),
      steps,
    };
  });
}
