import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  assertArchitectureReadyCoverage,
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

export function inspectArchitectureReadyCoverage(input: {
  projectDir: string;
}): string {
  return assertArchitectureReadyCoverage(input.projectDir);
}

export const architectureReadyCoverageOperation =
  defineWorkflowBlockingOperation<{ projectDir: string }, string>(
    import.meta.url,
    "inspectArchitectureReadyCoverage",
  );
