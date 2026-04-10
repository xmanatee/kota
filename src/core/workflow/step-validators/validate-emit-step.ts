import type { WorkflowEmitStep, WorkflowEmitStepInput } from "#core/workflow/types.js";
import {
  expectName,
  expectNonEmptyString,
  expectOptionalBoolean,
  expectOptionalFunction,
  expectOptionalObjectOrFunction,
} from "#core/workflow/validation-primitives.js";

export function validateEmitStep(
  step: WorkflowEmitStepInput,
  definitionPath: string,
  index: number,
): WorkflowEmitStep {
  return {
    id: expectName(step.id, `steps[${index}].id`, definitionPath),
    type: "emit",
    event: expectNonEmptyString(step.event, `steps[${index}].event`, definitionPath),
    payload: expectOptionalObjectOrFunction(
      step.payload,
      `steps[${index}].payload`,
      definitionPath,
    ) as WorkflowEmitStep["payload"],
    when: expectOptionalFunction(
      step.when,
      `steps[${index}].when`,
      definitionPath,
    ) as WorkflowEmitStep["when"],
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
