import type { WorkflowBaseStep } from "#core/workflow/step-input-base.js";
import { WorkflowDefinitionError } from "#core/workflow/validation-primitives.js";

export function validateExposedOutputTrust(
  step: Pick<WorkflowBaseStep, "exposeOutputToAgent" | "exposedOutputTrust">,
  stepLabel: string,
  definitionPath: string,
): "untrusted" | undefined {
  if (step.exposedOutputTrust === undefined) return undefined;
  if (step.exposedOutputTrust !== "untrusted") {
    throw new WorkflowDefinitionError(
      `${stepLabel}.exposedOutputTrust must be "untrusted"`,
      definitionPath,
    );
  }
  if (step.exposeOutputToAgent !== true) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.exposedOutputTrust requires exposeOutputToAgent: true`,
      definitionPath,
    );
  }
  return step.exposedOutputTrust;
}
