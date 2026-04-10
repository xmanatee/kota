import type { WorkflowCodeStep, WorkflowCodeStepInput } from "#core/workflow/types.js";
import {
  expectName,
  expectOptionalBoolean,
  expectOptionalFunction,
  WorkflowDefinitionError,
} from "#core/workflow/validation-primitives.js";

export function validateCodeStep(
  step: WorkflowCodeStepInput,
  definitionPath: string,
  index: number,
): WorkflowCodeStep {
  if (typeof step.run !== "function") {
    throw new WorkflowDefinitionError(
      `steps[${index}].run must be a function`,
      definitionPath,
    );
  }

  return {
    id: expectName(step.id, `steps[${index}].id`, definitionPath),
    type: "code",
    run: step.run,
    when: expectOptionalFunction(
      step.when,
      `steps[${index}].when`,
      definitionPath,
    ) as WorkflowCodeStep["when"],
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
