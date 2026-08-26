import {
  defineWorkflowBlockingOperation,
  type WorkflowBlockingOperationRunner,
} from "#core/workflow/blocking-operation.js";
import { checkTargetTaskResolved } from "./task-state-repair-checks.js";

export type BuilderRepairCheckOperationInput = {
  workspaceRoot: string;
  taskId: string;
};

export type BuilderRepairCheckOperationResult =
  | { status: "passed"; output: string }
  | { status: "failed"; output: string };

function captureRepairCheck(check: () => string): BuilderRepairCheckOperationResult {
  try {
    return { status: "passed", output: check() };
  } catch (error) {
    return {
      status: "failed",
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

export function runBuilderRepairCheckInWorker(
  input: BuilderRepairCheckOperationInput,
): BuilderRepairCheckOperationResult {
  return captureRepairCheck(() =>
    checkTargetTaskResolved(input.workspaceRoot, input.taskId)
  );
}

export const builderRepairCheckOperation = defineWorkflowBlockingOperation<
  BuilderRepairCheckOperationInput,
  BuilderRepairCheckOperationResult
>(import.meta.url, "runBuilderRepairCheckInWorker");

export async function runBuilderRepairCheck(
  runner: WorkflowBlockingOperationRunner,
  input: BuilderRepairCheckOperationInput,
): Promise<string> {
  const result = await runner.runBlocking(builderRepairCheckOperation, input);
  if (result.status === "failed") throw new Error(result.output);
  return result.output;
}
