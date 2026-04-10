import { matchesFilter } from "./run-executor-utils.js";
import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowApprovalStepInput,
  WorkflowBranchStepInput,
  WorkflowDefinition,
  WorkflowForeachStepInput,
  WorkflowParallelGroupInput,
  WorkflowRestartStep,
  WorkflowStep,
  WorkflowStepInput,
  WorkflowTriggerStep,
  WorkflowTriggerStepInput,
} from "./types.js";
import {
  expectName,
  expectOptionalBoolean,
  expectOptionalInteger,
  expectOptionalPositiveNumber,
  expectOptionalString,
  expectOptionalStringArray,
  expectRelativePath,
  WorkflowDefinitionError,
} from "./validation-primitives.js";
import {
  validateAgentStep,
  validateApprovalStep,
  validateBranchStep,
  validateCodeStep,
  validateEmitStep,
  validateForeachStep,
  validateParallelGroup,
  validateRestartStep,
  validateToolStep,
  validateTriggerStep,
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
    return validateParallelGroup(step as WorkflowParallelGroupInput, definitionPath, index, projectDir);
  }
  if (step.type === "trigger") {
    return validateTriggerStep(step as WorkflowTriggerStepInput, definitionPath, index);
  }
  if (step.type === "branch") {
    return validateBranchStep(
      step as WorkflowBranchStepInput,
      definitionPath,
      index,
      projectDir,
      (armStep, dp, armIndex, pd) => validateStep(armStep, dp, armIndex, pd),
    );
  }
  if (step.type === "foreach") {
    return validateForeachStep(
      step as WorkflowForeachStepInput,
      definitionPath,
      index,
      projectDir,
    );
  }
  if (step.type === "approval") {
    return validateApprovalStep(
      step as WorkflowApprovalStepInput,
      definitionPath,
      index,
    );
  }

  throw new WorkflowDefinitionError(
    `steps[${index}].type must be "tool", "agent", "emit", "restart", "code", "parallel", "trigger", "branch", "foreach", or "approval"`,
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
    const collectStepIds = (flatSteps: WorkflowStep[]) => {
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
          collectStepIds(step.ifTrue);
          collectStepIds(step.ifFalse);
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
    collectStepIds(steps);

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

    // Validate trigger steps: no self-referential triggers.
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

    // Warn about trigger steps that reference unknown workflows (may be loaded later by modules).
    // Also warn when a trigger step fires a child with an outputSchema but won't wait for the output.
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
      costAnomalyThreshold: expectOptionalPositiveNumber(
        definition.costAnomalyThreshold,
        "costAnomalyThreshold",
        definitionPath,
      ),
      concurrencyGroup: expectOptionalString(
        definition.concurrencyGroup,
        "concurrencyGroup",
        definitionPath,
      ),
      inputSchema:
        definition.inputSchema != null
          ? (definition.inputSchema as Record<string, unknown>)
          : undefined,
      outputSchema:
        definition.outputSchema != null
          ? (definition.outputSchema as Record<string, unknown>)
          : undefined,
      webhookRateLimit: (() => {
        if (definition.webhookRateLimit == null) return undefined;
        const rl = definition.webhookRateLimit;
        if (typeof rl !== "object" || rl === null) {
          throw new WorkflowDefinitionError(
            "webhookRateLimit must be an object",
            definitionPath,
          );
        }
        const maxPerMinute = expectOptionalInteger(
          (rl as { maxPerMinute?: unknown }).maxPerMinute,
          "webhookRateLimit.maxPerMinute",
          definitionPath,
          1,
        );
        if (!maxPerMinute || maxPerMinute < 1) {
          throw new WorkflowDefinitionError(
            "webhookRateLimit.maxPerMinute must be an integer >= 1",
            definitionPath,
          );
        }
        return { maxPerMinute };
      })(),
      notify: (() => {
        if (definition.notify == null) return undefined;
        const n = definition.notify;
        if (typeof n !== "object" || n === null) {
          throw new WorkflowDefinitionError("notify must be an object", definitionPath);
        }
        const { onFailure, onSuccess, onCostAnomaly } = n as Record<string, unknown>;
        if (onFailure !== undefined && typeof onFailure !== "boolean") {
          throw new WorkflowDefinitionError("notify.onFailure must be a boolean", definitionPath);
        }
        if (onSuccess !== undefined && typeof onSuccess !== "boolean") {
          throw new WorkflowDefinitionError("notify.onSuccess must be a boolean", definitionPath);
        }
        if (onCostAnomaly !== undefined && typeof onCostAnomaly !== "boolean") {
          throw new WorkflowDefinitionError("notify.onCostAnomaly must be a boolean", definitionPath);
        }
        return {
          ...(onFailure !== undefined ? { onFailure: onFailure as boolean } : {}),
          ...(onSuccess !== undefined ? { onSuccess: onSuccess as boolean } : {}),
          ...(onCostAnomaly !== undefined ? { onCostAnomaly: onCostAnomaly as boolean } : {}),
        };
      })(),
      definitionPath,
      triggers: (() => {
        const triggers = definition.triggers.map((trigger, triggerIndex) =>
          validateTrigger(trigger, definitionPath, triggerIndex),
        );
        for (const trigger of triggers) {
          if (trigger.event === "workflow.completed") {
            const selfMatches = [
              "success",
              "failed",
              "interrupted",
              "completed-with-warnings",
            ].some((status) =>
              matchesFilter(trigger.filter, {
                workflow: name,
                status,
                triggerEvent: "manual",
                durationMs: 0,
                definitionPath,
                runDir: ".kota/runs/self",
                runId: "self",
              }),
            );
            if (selfMatches) {
              throw new WorkflowDefinitionError(
                `workflow "${name}" has a "workflow.completed" trigger that can match its own completion payload — ` +
                  `this would trigger after the workflow's own completion and create an infinite loop.`,
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
