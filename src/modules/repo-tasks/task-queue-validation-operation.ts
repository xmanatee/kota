import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  assertTaskQueueValid,
  type TaskQueueValidationOptions,
  type TaskQueueValidationResult,
} from "./task-queue-validation.js";

export type TaskQueueValidationOperationInput = {
  projectDir: string;
  options?: TaskQueueValidationOptions;
};

export function inspectTaskQueueValidation(
  input: TaskQueueValidationOperationInput,
): TaskQueueValidationResult {
  return assertTaskQueueValid(input.projectDir, input.options);
}

export const taskQueueValidationOperation = defineWorkflowBlockingOperation<
  TaskQueueValidationOperationInput,
  TaskQueueValidationResult
>(import.meta.url, "inspectTaskQueueValidation");
