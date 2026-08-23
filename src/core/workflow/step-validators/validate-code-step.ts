import { hasAgentHarness, resolveAgentHarness } from "#core/agent-harness/registry.js";
import type { CodeStepOutputValidator, WorkflowCodeStepInput } from "#core/workflow/step-input-code.js";
import type {
  WorkflowAgentRunContractResolver,
  WorkflowCodeStep,
} from "#core/workflow/step-types.js";
import { resolveStaticWorkflowAgentRunContract } from "#core/workflow/steps/step-executor-agent-run-contract.js";
import { resolveWorkflowValidationAgentRuntime } from "#core/workflow/validation-agent-runtime.js";
import {
  expectName,
  expectOptionalBoolean,
  expectOptionalFunction,
  validateProgressStepTimeouts,
  WorkflowDefinitionError,
  type WorkflowValidationOptions,
} from "#core/workflow/validation-primitives.js";
import { validateExposedOutputTrust } from "./validate-exposed-output-trust.js";

export function validateCodeStep(
  step: WorkflowCodeStepInput,
  definitionPath: string,
  index: number,
  stepLabel = `steps[${index}]`,
  options: {
    allowWorkspaceDirUpdate?: boolean;
    allowRuntimeResourcesUpdate?: boolean;
    allowRerunOnRetry?: boolean;
  } = {},
  validationOptions: WorkflowValidationOptions = {},
  workflowName = "<unresolved>",
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
  const rerunOnRetry = expectOptionalBoolean(
    step.rerunOnRetry,
    `${stepLabel}.rerunOnRetry`,
    definitionPath,
  );
  if (rerunOnRetry === true && options.allowRerunOnRetry === false) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.rerunOnRetry is only supported on top-level code steps`,
      definitionPath,
    );
  }

  const resolveAgentContract = expectOptionalFunction(
    step.resolveAgentContract,
    `${stepLabel}.resolveAgentContract`,
    definitionPath,
  ) as WorkflowAgentRunContractResolver | undefined;

  const validatedStep: WorkflowCodeStep = {
    id: expectName(step.id, `${stepLabel}.id`, definitionPath),
    type: "code",
    run: step.run,
    ...(updatesWorkspaceDir !== undefined ? { updatesWorkspaceDir } : {}),
    ...(updatesRuntimeResources !== undefined
      ? { updatesRuntimeResources }
      : {}),
    ...(rerunOnRetry !== undefined ? { rerunOnRetry } : {}),
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
    exposedOutputTrust: validateExposedOutputTrust(
      step,
      stepLabel,
      definitionPath,
    ),
    ...(step.validate !== undefined
      ? { validate: step.validate as CodeStepOutputValidator<unknown> }
      : {}),
    ...(resolveAgentContract !== undefined ? { resolveAgentContract } : {}),
  };

  if (resolveAgentContract !== undefined) {
    try {
      const contract = resolveAgentContract(
        resolveWorkflowValidationAgentRuntime(validationOptions),
      );
      if (hasAgentHarness(contract.harness)) {
        resolveStaticWorkflowAgentRunContract({
          step: contract,
          harness: resolveAgentHarness(contract.harness),
          source: `workflow:${workflowName}/${stepLabel}`,
        });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new WorkflowDefinitionError(
        `workflow "${workflowName}" ${stepLabel} resolved code-step agent run contract is incompatible: ${detail}`,
        definitionPath,
      );
    }
  }

  return validatedStep;
}
