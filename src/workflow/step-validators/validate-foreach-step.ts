import type {
  WorkflowAgentStep,
  WorkflowAgentStepInput,
  WorkflowCodeStep,
  WorkflowCodeStepInput,
  WorkflowForeachStep,
  WorkflowForeachStepInput,
} from "../types.js";
import {
  expectName,
  expectNonEmptyString,
  expectOptionalBoolean,
  expectOptionalFunction,
  expectOptionalInteger,
  WorkflowDefinitionError,
} from "../validation-primitives.js";
import { validateAgentStep } from "./validate-agent-step.js";
import { validateCodeStep } from "./validate-code-step.js";

export function validateForeachStep(
  step: WorkflowForeachStepInput,
  definitionPath: string,
  index: number,
  projectDir: string,
): WorkflowForeachStep {
  if (step.items === undefined || step.items === null) {
    throw new WorkflowDefinitionError(
      `steps[${index}].items is required`,
      definitionPath,
    );
  }
  if (typeof step.items !== "function" && !Array.isArray(step.items)) {
    throw new WorkflowDefinitionError(
      `steps[${index}].items must be a function or array`,
      definitionPath,
    );
  }

  const as = expectNonEmptyString(step.as, `steps[${index}].as`, definitionPath);

  if (!Array.isArray(step.steps) || step.steps.length === 0) {
    throw new WorkflowDefinitionError(
      `steps[${index}].steps must be a non-empty array`,
      definitionPath,
    );
  }

  const innerSteps = step.steps.map((innerStep, innerIndex) => {
    if (!innerStep || typeof innerStep !== "object") {
      throw new WorkflowDefinitionError(
        `steps[${index}].steps[${innerIndex}] must be an object`,
        definitionPath,
      );
    }
    if (innerStep.type !== "code" && innerStep.type !== "agent") {
      throw new WorkflowDefinitionError(
        `steps[${index}].steps[${innerIndex}].type must be "code" or "agent" — foreach, parallel, branch, trigger, emit, and restart are not allowed inside a foreach body`,
        definitionPath,
      );
    }
    if (innerStep.type === "code") {
      return validateCodeStep(innerStep as WorkflowCodeStepInput, definitionPath, innerIndex) as WorkflowCodeStep;
    }
    return validateAgentStep(innerStep as WorkflowAgentStepInput, definitionPath, innerIndex, projectDir) as WorkflowAgentStep;
  });

  return {
    id: expectName(step.id, `steps[${index}].id`, definitionPath),
    type: "foreach",
    items: step.items,
    as,
    steps: innerSteps,
    when: expectOptionalFunction(
      step.when,
      `steps[${index}].when`,
      definitionPath,
    ) as WorkflowForeachStep["when"],
    continueOnFailure: expectOptionalBoolean(
      step.continueOnFailure,
      `steps[${index}].continueOnFailure`,
      definitionPath,
    ),
    timeoutMs: expectOptionalInteger(
      step.timeoutMs,
      `steps[${index}].timeoutMs`,
      definitionPath,
      1,
    ),
    exposeOutputToAgent: expectOptionalBoolean(
      step.exposeOutputToAgent,
      `steps[${index}].exposeOutputToAgent`,
      definitionPath,
    ),
  };
}
