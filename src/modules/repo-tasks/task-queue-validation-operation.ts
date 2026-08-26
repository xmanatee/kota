import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  assertTaskQueueValid,
  type TaskQueueValidationResult,
} from "./task-queue-validation.js";

export type TaskQueueValidationOperationInput = {
  projectDir: string;
};

export function inspectTaskQueueValidation(
  input: TaskQueueValidationOperationInput,
): TaskQueueValidationResult {
  return assertTaskQueueValid(input.projectDir);
}

export const taskQueueValidationOperation = defineWorkflowBlockingOperation<
  TaskQueueValidationOperationInput,
  TaskQueueValidationResult
>(import.meta.url, "inspectTaskQueueValidation");
