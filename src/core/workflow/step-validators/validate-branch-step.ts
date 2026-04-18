import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type {
  WorkflowBranchStep,
  WorkflowBranchStepInput,
  WorkflowStep,
  WorkflowStepInput,
} from "#core/workflow/types.js";
import {
  expectName,
  expectOptionalBoolean,
  expectOptionalFunction,
  expectOptionalInteger,
  WorkflowDefinitionError,
} from "#core/workflow/validation-primitives.js";

export const MAX_BRANCH_DEPTH = 5;

export function validateBranchStep(
  step: WorkflowBranchStepInput,
  definitionPath: string,
  index: number,
  moduleRoot: string,
  workflowDefaultAutonomyMode: AutonomyMode | undefined,
  validateArmStep: (
    armStep: WorkflowStepInput,
    definitionPath: string,
    armIndex: number,
    moduleRoot: string,
    workflowDefaultAutonomyMode: AutonomyMode | undefined,
  ) => WorkflowStep,
  depth = 0,
): WorkflowBranchStep {
  if (depth >= MAX_BRANCH_DEPTH) {
    throw new WorkflowDefinitionError(
      `steps[${index}] branch nesting depth exceeds maximum of ${MAX_BRANCH_DEPTH}`,
      definitionPath,
    );
  }

  if (typeof step.condition !== "function") {
    throw new WorkflowDefinitionError(
      `steps[${index}].condition must be a function`,
      definitionPath,
    );
  }

  if (!Array.isArray(step.ifTrue) || step.ifTrue.length === 0) {
    throw new WorkflowDefinitionError(
      `steps[${index}].ifTrue must be a non-empty array`,
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

  const ifTrue = validateArm(step.ifTrue, `steps[${index}].ifTrue`);
  const ifFalse = step.ifFalse
    ? validateArm(step.ifFalse, `steps[${index}].ifFalse`)
    : [];

  return {
    id: expectName(step.id, `steps[${index}].id`, definitionPath),
    type: "branch",
    condition: step.condition,
    ifTrue,
    ifFalse,
    when: expectOptionalFunction(
      step.when,
      `steps[${index}].when`,
      definitionPath,
    ) as WorkflowBranchStep["when"],
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
  };
}
