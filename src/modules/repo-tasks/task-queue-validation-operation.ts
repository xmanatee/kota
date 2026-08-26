import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  assertTaskQueueValid,
  type TaskQueueValidationResult,
} from "./task-queue-validation.js";

export type TaskQueueValidationOperationInput = {
  workspaceRoot: string;
};

export function inspectTaskQueueValidation(
  input: TaskQueueValidationOperationInput,
): TaskQueueValidationResult {
  return assertTaskQueueValid(input.workspaceRoot);
}

export const taskQueueValidationOperation = defineWorkflowBlockingOperation<
  TaskQueueValidationOperationInput,
  TaskQueueValidationResult
>(import.meta.url, "inspectTaskQueueValidation");
