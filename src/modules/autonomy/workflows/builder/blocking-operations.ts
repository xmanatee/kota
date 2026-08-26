import {
  defineWorkflowBlockingOperation,
  type WorkflowBlockingOperationRunner,
} from "#core/workflow/blocking-operation.js";
import { checkDocBloat } from "#modules/autonomy/doc-bloat-check.js";
import { checkRepoHygiene } from "#modules/autonomy/hygiene-check.js";
import { checkModuleBoundary } from "./project-repair-checks.js";
import {
  checkTargetTaskResolved,
} from "./task-state-repair-checks.js";

export type BuilderRepairCheckOperationInput =
  | {
      kind: "target-task-resolved";
      projectDir: string;
      taskId: string;
    }
  | {
      kind: "doc-bloat";
      projectDir: string;
    }
  | {
      kind: "module-boundary";
      projectDir: string;
    }
  | {
      kind: "repo-hygiene";
      projectDir: string;
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
  if (input.kind === "target-task-resolved") {
    return captureRepairCheck(() => checkTargetTaskResolved(input.projectDir, input.taskId));
  }
  if (input.kind === "doc-bloat") {
    return captureRepairCheck(() => checkDocBloat(input.projectDir));
  }
  if (input.kind === "module-boundary") {
    return captureRepairCheck(() => checkModuleBoundary(input.projectDir));
  }
  if (input.kind === "repo-hygiene") {
    return captureRepairCheck(() => checkRepoHygiene(input.projectDir));
  }
  throw new Error(`Unsupported builder repair check input: ${input satisfies never}`);
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
