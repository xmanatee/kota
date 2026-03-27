import type { WorkflowToolStep, WorkflowToolStepInput } from "../types.js";
import {
  expectName,
  expectNonEmptyString,
  expectOptionalBoolean,
  expectOptionalFunction,
  expectOptionalObjectOrFunction,
} from "../validation-primitives.js";

export function validateToolStep(
  step: WorkflowToolStepInput,
  definitionPath: string,
  index: number,
): WorkflowToolStep {
  return {
    id: expectName(step.id, `steps[${index}].id`, definitionPath),
    type: "tool",
    tool: expectNonEmptyString(step.tool, `steps[${index}].tool`, definitionPath),
    input: expectOptionalObjectOrFunction(
      step.input,
      `steps[${index}].input`,
      definitionPath,
    ) as WorkflowToolStep["input"],
    when: expectOptionalFunction(
      step.when,
      `steps[${index}].when`,
      definitionPath,
    ) as WorkflowToolStep["when"],
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
    retry: step.retry,
  };
}
