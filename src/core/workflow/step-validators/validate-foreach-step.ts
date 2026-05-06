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

export function validateForeachStep(
  step: WorkflowForeachStepInput,
  definitionPath: string,
  index: number,
  moduleRoot: string,
  workflowDefaultAutonomyMode: AutonomyMode | undefined,
  options: WorkflowValidationOptions,
): WorkflowForeachStep {
  if (step.items === undefined || step.items === null) {
    throw new WorkflowDefinitionError(
      `steps[${index}].items is required`,
      definitionPath,
    );
  }
  if (typeof step.items !== "function" && !Array.isArray(step.items)) {
    throw new WorkflowDefinitionError(
      `steps[${index}].items must be a function or array`,
      definitionPath,
    );
  }

  const as = expectNonEmptyString(step.as, `steps[${index}].as`, definitionPath);

  if (!Array.isArray(step.steps) || step.steps.length === 0) {
    throw new WorkflowDefinitionError(
      `steps[${index}].steps must be a non-empty array`,
      definitionPath,
    );
  }

  const maxConcurrency = expectOptionalInteger(
    step.maxConcurrency,
    `steps[${index}].maxConcurrency`,
    definitionPath,
    1,
  );

  if (maxConcurrency !== undefined && maxConcurrency > 1) {
    const hasAgentStep = step.steps.some(
      (s) => s && typeof s === "object" && s.type === "agent",
    );
    if (hasAgentStep) {
      throw new WorkflowDefinitionError(
        `steps[${index}].maxConcurrency > 1 is not allowed when inner steps include agent steps — concurrent agent steps contend for the agentConcurrency slot`,
        definitionPath,
      );
    }
  }

  const innerSteps = step.steps.map((innerStep, innerIndex) => {
    if (!innerStep || typeof innerStep !== "object") {
      throw new WorkflowDefinitionError(
        `steps[${index}].steps[${innerIndex}] must be an object`,
        definitionPath,
      );
    }
    if (innerStep.type !== "code" && innerStep.type !== "agent") {
      throw new WorkflowDefinitionError(
        `steps[${index}].steps[${innerIndex}].type must be "code" or "agent" — foreach, parallel, branch, trigger, emit, and restart are not allowed inside a foreach body`,
        definitionPath,
      );
    }
    if (innerStep.type === "code") {
      return validateCodeStep(innerStep as WorkflowCodeStepInput, definitionPath, innerIndex) as WorkflowCodeStep;
    }
    return validateAgentStep(
      innerStep as WorkflowAgentStepInput,
      definitionPath,
      innerIndex,
      moduleRoot,
      workflowDefaultAutonomyMode,
      options,
    ) as WorkflowAgentStep;
  });

  return {
    id: expectName(step.id, `steps[${index}].id`, definitionPath),
    type: "foreach",
    items: step.items,
    as,
    steps: innerSteps,
    maxConcurrency,
    when: expectOptionalFunction(
      step.when,
      `steps[${index}].when`,
      definitionPath,
    ) as WorkflowForeachStep["when"],
    continueOnFailure: expectOptionalBoolean(
      step.continueOnFailure,
      `steps[${index}].continueOnFailure`,
      definitionPath,
    ),
    timeoutMs: expectOptionalInteger(
      step.timeoutMs,
      `steps[${index}].timeoutMs`,
      definitionPath,
      1,
    ),
    exposeOutputToAgent: expectOptionalBoolean(
      step.exposeOutputToAgent,
      `steps[${index}].exposeOutputToAgent`,
      definitionPath,
    ),
    retryFailedItems: expectOptionalBoolean(
      step.retryFailedItems,
      `steps[${index}].retryFailedItems`,
      definitionPath,
    ),
  };
}
