import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { WorkflowAgentStepInput } from "#core/workflow/step-input-base.js";
import type { WorkflowCodeStepInput } from "#core/workflow/step-input-code.js";
import type { WorkflowForeachStepInput } from "#core/workflow/step-input-control-flow.js";
import type { WorkflowAgentStep, WorkflowCodeStep, WorkflowForeachStep } from "#core/workflow/step-types.js";
import {
  expectName,
  expectNonEmptyString,
  expectOptionalBoolean,
  expectOptionalFunction,
  expectOptionalInteger,
  WorkflowDefinitionError,
  type WorkflowValidationOptions,
} from "#core/workflow/validation-primitives.js";
import { validateAgentStep } from "./validate-agent-step.js";
import { validateCodeStep } from "./validate-code-step.js";
import { validateExposedOutputTrust } from "./validate-exposed-output-trust.js";

export function validateForeachStep(
  step: WorkflowForeachStepInput,
  definitionPath: string,
  _index: number,
  moduleRoot: string,
  workflowDefaultAutonomyMode: AutonomyMode | undefined,
  options: WorkflowValidationOptions,
  stepLabel: string,
  workflowName: string,
): WorkflowForeachStep {
  if (step.items === undefined || step.items === null) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.items is required`,
      definitionPath,
    );
  }
  if (step.idleTimeoutMs !== undefined) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.idleTimeoutMs is not supported on foreach groups — put idleTimeoutMs on leaf steps`,
      definitionPath,
    );
  }
  if (typeof step.items !== "function" && !Array.isArray(step.items)) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.items must be a function or array`,
      definitionPath,
    );
  }

  const as = expectNonEmptyString(step.as, `${stepLabel}.as`, definitionPath);

  if (!Array.isArray(step.steps) || step.steps.length === 0) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.steps must be a non-empty array`,
      definitionPath,
    );
  }

  const maxConcurrency = expectOptionalInteger(
    step.maxConcurrency,
    `${stepLabel}.maxConcurrency`,
    definitionPath,
    1,
  );

  const innerSteps = step.steps.map((innerStep, innerIndex) => {
    if (!innerStep || typeof innerStep !== "object") {
      throw new WorkflowDefinitionError(
        `${stepLabel}.steps[${innerIndex}] must be an object`,
        definitionPath,
      );
    }
    if (innerStep.type !== "code" && innerStep.type !== "agent") {
      throw new WorkflowDefinitionError(
        `${stepLabel}.steps[${innerIndex}].type must be "code" or "agent" — foreach, parallel, branch, trigger, emit, and restart are not allowed inside a foreach body`,
        definitionPath,
      );
    }
    if (innerStep.type === "code") {
      return validateCodeStep(
        innerStep as WorkflowCodeStepInput,
        definitionPath,
        innerIndex,
        `${stepLabel}.steps[${innerIndex}]`,
        {
          allowRerunOnRetry: false,
        },
        options,
        workflowName,
      ) as WorkflowCodeStep;
    }
    return validateAgentStep(
      innerStep as WorkflowAgentStepInput,
      definitionPath,
      `${stepLabel}.steps[${innerIndex}]`,
      moduleRoot,
      workflowDefaultAutonomyMode,
      options,
      workflowName,
    ) as WorkflowAgentStep;
  });

  return {
    id: expectName(step.id, `${stepLabel}.id`, definitionPath),
    type: "foreach",
    items: step.items,
    as,
    steps: innerSteps,
    maxConcurrency,
    when: expectOptionalFunction(
      step.when,
      `${stepLabel}.when`,
      definitionPath,
    ) as WorkflowForeachStep["when"],
    continueOnFailure: expectOptionalBoolean(
      step.continueOnFailure,
      `${stepLabel}.continueOnFailure`,
      definitionPath,
    ),
    timeoutMs: expectOptionalInteger(
      step.timeoutMs,
      `${stepLabel}.timeoutMs`,
      definitionPath,
      1,
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
    retryFailedItems: expectOptionalBoolean(
      step.retryFailedItems,
      `${stepLabel}.retryFailedItems`,
      definitionPath,
    ),
  };
}
