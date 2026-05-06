import type { WorkflowRestartStepInput } from "#core/workflow/step-input-types.js";
import type { WorkflowRestartStep } from "#core/workflow/step-types.js";
import {
  expectName,
  expectOptionalBoolean,
  expectOptionalFunction,
  expectOptionalStringArray,
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
