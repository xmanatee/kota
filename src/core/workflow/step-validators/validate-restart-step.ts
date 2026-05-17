import type { WorkflowRestartStepInput } from "#core/workflow/step-input-base.js";
import type { WorkflowRestartStep } from "#core/workflow/step-types.js";
import {
  expectName,
  expectOptionalBoolean,
  expectOptionalFunction,
  expectOptionalStringArray,
  validateBaseStepTimeouts,
  WorkflowDefinitionError,
} from "#core/workflow/validation-primitives.js";

export function validateRestartStep(
  step: WorkflowRestartStepInput,
  definitionPath: string,
  index: number,
): WorkflowRestartStep {
  const reason = step.reason;
  if (
    reason !== undefined &&
    typeof reason !== "string" &&
    typeof reason !== "function"
  ) {
    throw new WorkflowDefinitionError(
      `steps[${index}].reason must be a string or function`,
      definitionPath,
    );
  }

  return {
    id: expectName(step.id, `steps[${index}].id`, definitionPath),
    type: "restart",
    reason: reason as WorkflowRestartStep["reason"],
    ...validateBaseStepTimeouts(step, `steps[${index}]`, definitionPath),
    requires:
      expectOptionalStringArray(
        step.requires,
        `steps[${index}].requires`,
        definitionPath,
      ) ?? [],
    when: expectOptionalFunction(
      step.when,
      `steps[${index}].when`,
      definitionPath,
    ) as WorkflowRestartStep["when"],
    continueOnFailure: expectOptionalBoolean(
      step.continueOnFailure,
      `steps[${index}].continueOnFailure`,
      definitionPath,
    ),
    exposeOutputToAgent: expectOptionalBoolean(
      step.exposeOutputToAgent,
      `steps[${index}].exposeOutputToAgent`,
      definitionPath,
    ),
  };
}
