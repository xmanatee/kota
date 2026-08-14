import {
  runWorkflowBlockingOperation,
  type WorkflowBlockingOperationRunner,
} from "./blocking-operation.js";
import type { WorkflowStepContext } from "./run-types.js";

export type WorkflowBlockingStepContext = WorkflowStepContext &
  WorkflowBlockingOperationRunner;

export function withWorkflowBlockingOperation(
  context: WorkflowStepContext,
): WorkflowBlockingStepContext {
  if (
    "runBlocking" in context &&
    typeof context.runBlocking === "function"
  ) {
    return context as WorkflowBlockingStepContext;
  }
  return {
    ...context,
    runBlocking: (operation, input) =>
      runWorkflowBlockingOperation(operation, input, {
        signal: context.signal,
        reportProgress: context.reportProgress,
      }),
  };
}
