import type { WorkflowApprovalStepInput } from "#core/workflow/step-input-control-flow.js";
import type { WorkflowApprovalStep } from "#core/workflow/step-types.js";
import {
  expectName,
  expectOptionalBoolean,
  expectOptionalFunction,
  expectOptionalString,
  validateBaseStepTimeouts,
  WorkflowDefinitionError,
} from "#core/workflow/validation-primitives.js";

const VALID_DEFAULT_RESOLUTIONS = new Set(["deny", "approve"]);

export function validateApprovalStep(
  step: WorkflowApprovalStepInput,
  definitionPath: string,
  index: number,
): WorkflowApprovalStep {
  if (
    step.defaultResolution !== undefined &&
    !VALID_DEFAULT_RESOLUTIONS.has(step.defaultResolution)
  ) {
    throw new WorkflowDefinitionError(
      `steps[${index}].defaultResolution must be "deny" or "approve"`,
      definitionPath,
    );
  }

  return {
    id: expectName(step.id, `steps[${index}].id`, definitionPath),
    type: "approval",
    reason: expectOptionalString(step.reason, `steps[${index}].reason`, definitionPath),
    defaultResolution: step.defaultResolution,
    ...validateBaseStepTimeouts(step, `steps[${index}]`, definitionPath),
    when: expectOptionalFunction(
      step.when,
      `steps[${index}].when`,
      definitionPath,
    ) as WorkflowApprovalStep["when"],
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
