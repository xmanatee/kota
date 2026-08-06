import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { WorkflowBranchStepInput } from "#core/workflow/step-input-control-flow.js";
import type { WorkflowStepInput } from "#core/workflow/step-input-types.js";
import type { WorkflowBranchStep, WorkflowStep } from "#core/workflow/step-types.js";
import {
  expectName,
  expectOptionalBoolean,
  expectOptionalFunction,
  expectOptionalInteger,
  WorkflowDefinitionError,
} from "#core/workflow/validation-primitives.js";
import { validateExposedOutputTrust } from "./validate-exposed-output-trust.js";

export const MAX_BRANCH_DEPTH = 5;

export function validateBranchStep(
  step: WorkflowBranchStepInput,
  definitionPath: string,
  _index: number,
  moduleRoot: string,
  workflowDefaultAutonomyMode: AutonomyMode | undefined,
  validateArmStep: (
    armStep: WorkflowStepInput,
    definitionPath: string,
    armIndex: number,
    moduleRoot: string,
    workflowDefaultAutonomyMode: AutonomyMode | undefined,
    stepLabel: string,
  ) => WorkflowStep,
  stepLabel: string,
  depth = 0,
): WorkflowBranchStep {
  if (depth >= MAX_BRANCH_DEPTH) {
    throw new WorkflowDefinitionError(
      `${stepLabel} branch nesting depth exceeds maximum of ${MAX_BRANCH_DEPTH}`,
      definitionPath,
    );
  }

  if (typeof step.condition !== "function") {
    throw new WorkflowDefinitionError(
      `${stepLabel}.condition must be a function`,
      definitionPath,
    );
  }
  if (step.idleTimeoutMs !== undefined) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.idleTimeoutMs is not supported on branch groups — put idleTimeoutMs on leaf steps`,
      definitionPath,
    );
  }

  if (!Array.isArray(step.ifTrue) || step.ifTrue.length === 0) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.ifTrue must be a non-empty array`,
      definitionPath,
    );
  }

  const validateArm = (
    arm: WorkflowStepInput[],
    armLabel: string,
  ): WorkflowStep[] =>
    arm.map((armStep, armIndex) => {
      const validated = validateArmStep(
        armStep,
        definitionPath,
        armIndex,
        moduleRoot,
        workflowDefaultAutonomyMode,
        `${armLabel}[${armIndex}]`,
      );
      if (validated.type === "restart") {
        throw new WorkflowDefinitionError(
          `${armLabel}[${armIndex}] restart steps are not allowed inside branch arms`,
          definitionPath,
        );
      }
      if (validated.type === "approval") {
        throw new WorkflowDefinitionError(
          `${armLabel}[${armIndex}] approval steps are not allowed inside branch arms`,
          definitionPath,
        );
      }
      return validated;
    });

  const ifTrue = validateArm(step.ifTrue, `${stepLabel}.ifTrue`);
  const ifFalse = step.ifFalse
    ? validateArm(step.ifFalse, `${stepLabel}.ifFalse`)
    : [];

  return {
    id: expectName(step.id, `${stepLabel}.id`, definitionPath),
    type: "branch",
    condition: step.condition,
    ifTrue,
    ifFalse,
    when: expectOptionalFunction(
      step.when,
      `${stepLabel}.when`,
      definitionPath,
    ) as WorkflowBranchStep["when"],
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
  };
}
