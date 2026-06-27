import type { WorkflowStepInput } from "#core/workflow/step-input-types.js";
import {
  executeBranchStep,
  executeParallelStep,
} from "./execute-control-flow.js";
import { executeForeachStep } from "./execute-foreach-step.js";
import { executeLeafStep } from "./execute-leaf-step.js";
import type { HarnessExecutionState } from "./execution-state.js";

export type HarnessStepExecutor = (step: WorkflowStepInput) => Promise<void>;

export async function executeHarnessStep(
  step: WorkflowStepInput,
  state: HarnessExecutionState,
): Promise<void> {
  if (step.type === "branch") {
    await executeBranchStep(step, state, (innerStep) =>
      executeHarnessStep(innerStep, state)
    );
    return;
  }
  if (step.type === "foreach") {
    await executeForeachStep(step, state);
    return;
  }
  if (step.type === "parallel") {
    await executeParallelStep(step, state, (innerStep) =>
      executeHarnessStep(innerStep, state)
    );
    return;
  }
  await executeLeafStep(step, state);
}
