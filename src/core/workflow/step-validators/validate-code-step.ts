import type { CodeStepOutputValidator, WorkflowCodeStepInput } from "#core/workflow/step-input-code.js";
import type { WorkflowCodeStep } from "#core/workflow/step-types.js";
import {
  expectName,
  expectOptionalBoolean,
  expectOptionalFunction,
  validateProgressStepTimeouts,
  WorkflowDefinitionError,
} from "#core/workflow/validation-primitives.js";

export function validateCodeStep(
  step: WorkflowCodeStepInput,
  definitionPath: string,
  index: number,
  stepLabel = `steps[${index}]`,
  options: {
    allowWorkspaceDirUpdate?: boolean;
    allowRuntimeResourcesUpdate?: boolean;
  } = {},
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
  const updatesWorkspaceDir = expectOptionalBoolean(
    step.updatesWorkspaceDir,
    `${stepLabel}.updatesWorkspaceDir`,
    definitionPath,
  );
  if (updatesWorkspaceDir === true && options.allowWorkspaceDirUpdate === false) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.updatesWorkspaceDir is only supported on top-level code steps`,
      definitionPath,
    );
  }
  const updatesRuntimeResources = expectOptionalBoolean(
    step.updatesRuntimeResources,
    `${stepLabel}.updatesRuntimeResources`,
    definitionPath,
  );
  if (
    updatesRuntimeResources === true &&
    options.allowRuntimeResourcesUpdate === false
  ) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.updatesRuntimeResources is only supported on top-level code steps`,
      definitionPath,
    );
  }

  return {
    id: expectName(step.id, `${stepLabel}.id`, definitionPath),
    type: "code",
    run: step.run,
    ...(updatesWorkspaceDir !== undefined ? { updatesWorkspaceDir } : {}),
    ...(updatesRuntimeResources !== undefined
      ? { updatesRuntimeResources }
      : {}),
    ...validateProgressStepTimeouts(step, stepLabel, definitionPath),
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
