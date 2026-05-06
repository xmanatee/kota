import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type {
  WorkflowApprovalStepInput,
  WorkflowAwaitEventStepInput,
  WorkflowBranchStepInput,
  WorkflowForeachStepInput,
  WorkflowParallelGroupInput,
  WorkflowStep,
  WorkflowStepInput,
  WorkflowTriggerStepInput,
} from "./types.js";
import {
  WorkflowDefinitionError,
  type WorkflowValidationOptions,
} from "./validation-primitives.js";
import {
  validateAgentStep,
  validateApprovalStep,
  validateAwaitEventStep,
  validateBranchStep,
  validateCodeStep,
  validateEmitStep,
  validateForeachStep,
  validateParallelGroup,
  validateRestartStep,
  validateToolStep,
  validateTriggerStep,
} from "./validation-steps.js";

/**
 * Routes a raw step input to its per-step-type validator. Pure dispatch: each
 * step type is validated by a specialised function in `validation-steps.ts`;
 * this file owns only the type fan-out and the unrecognised-type error.
 */
export function validateStep(
  step: WorkflowStepInput,
  definitionPath: string,
  index: number,
  moduleRoot: string,
  workflowDefaultAutonomyMode: AutonomyMode | undefined,
  options: WorkflowValidationOptions,
): WorkflowStep {
  if (!step || typeof step !== "object") {
    throw new WorkflowDefinitionError(
      `steps[${index}] must be an object`,
      definitionPath,
    );
  }

  if (step.type === "tool") return validateToolStep(step, definitionPath, index);
  if (step.type === "agent") {
    return validateAgentStep(
      step,
      definitionPath,
      index,
      moduleRoot,
      workflowDefaultAutonomyMode,
      options,
    );
  }
  if (step.type === "emit") return validateEmitStep(step, definitionPath, index);
  if (step.type === "restart") {
    return validateRestartStep(step, definitionPath, index);
  }
  if (step.type === "code") return validateCodeStep(step, definitionPath, index);
  if (step.type === "parallel") {
    return validateParallelGroup(
      step as WorkflowParallelGroupInput,
      definitionPath,
      index,
      moduleRoot,
      workflowDefaultAutonomyMode,
      options,
    );
  }
  if (step.type === "trigger") {
    return validateTriggerStep(step as WorkflowTriggerStepInput, definitionPath, index);
  }
  if (step.type === "branch") {
    return validateBranchStep(
      step as WorkflowBranchStepInput,
      definitionPath,
      index,
      moduleRoot,
      workflowDefaultAutonomyMode,
      (armStep, dp, armIndex, root, armDefault) =>
        validateStep(armStep, dp, armIndex, root, armDefault, options),
    );
  }
  if (step.type === "foreach") {
    return validateForeachStep(
      step as WorkflowForeachStepInput,
      definitionPath,
      index,
      moduleRoot,
      workflowDefaultAutonomyMode,
      options,
    );
  }
  if (step.type === "approval") {
    return validateApprovalStep(
      step as WorkflowApprovalStepInput,
      definitionPath,
      index,
    );
  }
  if (step.type === "await-event") {
    return validateAwaitEventStep(
      step as WorkflowAwaitEventStepInput,
      definitionPath,
      index,
    );
  }

  throw new WorkflowDefinitionError(
    `steps[${index}].type must be "tool", "agent", "emit", "restart", "code", "parallel", "trigger", "branch", "foreach", "approval", or "await-event"`,
    definitionPath,
  );
}
