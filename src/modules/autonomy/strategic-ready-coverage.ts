import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { assertStrategicReadyCoverage } from "#modules/repo-tasks/task-queue-validation.js";

export function inspectStrategicReadyCoverage(input: {
  projectDir: string;
}): string {
  return assertStrategicReadyCoverage(input.projectDir);
}

export const strategicReadyCoverageOperation =
  defineWorkflowBlockingOperation<
    { projectDir: string },
    string
  >(import.meta.url, "inspectStrategicReadyCoverage");
