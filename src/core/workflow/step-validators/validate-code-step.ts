import type { CodeStepOutputValidator, WorkflowCodeStepInput } from "#core/workflow/step-input-code.js";
import type { WorkflowCodeStep } from "#core/workflow/step-types.js";
import {
  expectName,
  expectOptionalBoolean,
  expectOptionalFunction,
  validateBaseStepTimeouts,
  WorkflowDefinitionError,
} from "#core/workflow/validation-primitives.js";

export function validateCodeStep(
  step: WorkflowCodeStepInput,
  definitionPath: string,
  index: number,
  stepLabel = `steps[${index}]`,
): WorkflowCodeStep {
  if (typeof step.run !== "function") {
    throw new WorkflowDefinitionError(
      `${stepLabel}.run must be a function`,
      definitionPath,
    );
  }

  if (step.validate !== undefined && typeof step.validate !== "function") {
    throw new WorkflowDefinitionError(
      `${stepLabel}.validate must be a function`,
      definitionPath,
    );
  }

  return {
    id: expectName(step.id, `${stepLabel}.id`, definitionPath),
    type: "code",
    run: step.run,
    ...validateBaseStepTimeouts(step, stepLabel, definitionPath),
    when: expectOptionalFunction(
      step.when,
      `${stepLabel}.when`,
      definitionPath,
    ) as WorkflowCodeStep["when"],
    continueOnFailure: expectOptionalBoolean(
      step.continueOnFailure,
      `${stepLabel}.continueOnFailure`,
      definitionPath,
    ),
    exposeOutputToAgent: expectOptionalBoolean(
      step.exposeOutputToAgent,
      `${stepLabel}.exposeOutputToAgent`,
      definitionPath,
    ),
    ...(step.validate !== undefined
      ? { validate: step.validate as CodeStepOutputValidator<unknown> }
      : {}),
  };
}
