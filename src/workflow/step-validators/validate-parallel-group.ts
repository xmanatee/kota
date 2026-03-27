import type {
  WorkflowCodeStep,
  WorkflowCodeStepInput,
  WorkflowParallelGroup,
  WorkflowParallelGroupInput,
} from "../types.js";
import {
  expectName,
  expectOptionalBoolean,
  expectOptionalFunction,
  WorkflowDefinitionError,
} from "../validation-primitives.js";

export function validateParallelGroup(
  step: WorkflowParallelGroupInput,
  definitionPath: string,
  index: number,
): WorkflowParallelGroup {
  if (!Array.isArray(step.steps) || step.steps.length === 0) {
    throw new WorkflowDefinitionError(
      `steps[${index}].steps must be a non-empty array`,
      definitionPath,
    );
  }

  const steps = step.steps.map((childStep, childIndex) => {
    const label = `steps[${index}].steps[${childIndex}]`;
    if (!childStep || typeof childStep !== "object") {
      throw new WorkflowDefinitionError(`${label} must be an object`, definitionPath);
    }
    if ((childStep as { type?: unknown }).type !== "code") {
      throw new WorkflowDefinitionError(
        `${label}.type must be "code" (only code steps are supported in parallel groups)`,
        definitionPath,
      );
    }
    const codeStep = childStep as WorkflowCodeStepInput;
    if (typeof codeStep.run !== "function") {
      throw new WorkflowDefinitionError(`${label}.run must be a function`, definitionPath);
    }
    return {
      id: expectName(codeStep.id, `${label}.id`, definitionPath),
      type: "code" as const,
      run: codeStep.run,
      when: expectOptionalFunction(
        codeStep.when,
        `${label}.when`,
        definitionPath,
      ) as WorkflowCodeStep["when"],
      continueOnFailure: expectOptionalBoolean(
        codeStep.continueOnFailure,
        `${label}.continueOnFailure`,
        definitionPath,
      ),
    };
  });

  return {
    id: expectName(step.id, `steps[${index}].id`, definitionPath),
    type: "parallel",
    steps,
    when: expectOptionalFunction(
      step.when,
      `steps[${index}].when`,
      definitionPath,
    ) as WorkflowParallelGroup["when"],
    continueOnFailure: expectOptionalBoolean(
      step.continueOnFailure,
      `steps[${index}].continueOnFailure`,
      definitionPath,
    ),
  };
}
