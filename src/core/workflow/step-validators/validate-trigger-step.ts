import type { WorkflowTriggerStepInput } from "#core/workflow/step-input-types.js";
import type { WorkflowTriggerStep } from "#core/workflow/step-types.js";
import {
  expectName,
  expectNonEmptyString,
  expectOptionalBoolean,
  expectOptionalFunction,
  expectOptionalInteger,
  expectOptionalObjectOrFunction,
  WorkflowDefinitionError,
} from "#core/workflow/validation-primitives.js";

export function validateTriggerStep(
  step: WorkflowTriggerStepInput,
  definitionPath: string,
  index: number,
): WorkflowTriggerStep {
  const waitFor = step.waitFor ?? "queued";
  if (waitFor !== "queued" && waitFor !== "completed") {
    throw new WorkflowDefinitionError(
      `steps[${index}].waitFor must be "queued" or "completed"`,
      definitionPath,
    );
  }
  return {
    id: expectName(step.id, `steps[${index}].id`, definitionPath),
    type: "trigger",
    workflow: expectNonEmptyString(
      step.workflow,
      `steps[${index}].workflow`,
      definitionPath,
    ),
    payload: expectOptionalObjectOrFunction(
      step.payload,
      `steps[${index}].payload`,
      definitionPath,
    ) as WorkflowTriggerStep["payload"],
    waitFor,
    when: expectOptionalFunction(
      step.when,
      `steps[${index}].when`,
      definitionPath,
    ) as WorkflowTriggerStep["when"],
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
    timeoutMs: expectOptionalInteger(
      step.timeoutMs,
      `steps[${index}].timeoutMs`,
      definitionPath,
      1,
    ),
  };
}
