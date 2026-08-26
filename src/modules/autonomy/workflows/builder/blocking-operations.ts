import {
  defineWorkflowBlockingOperation,
  type WorkflowBlockingOperationRunner,
} from "#core/workflow/blocking-operation.js";
import { checkAutonomyChangeDecisionForRun } from "#modules/autonomy/autonomy-change-decision.js";
import { checkDocBloat } from "#modules/autonomy/doc-bloat-check.js";
import { checkRepoHygiene } from "#modules/autonomy/hygiene-check.js";
import { checkObservabilityObligationsForRun } from "#modules/autonomy/observability-obligation.js";
import { checkSourceFileSize } from "#modules/autonomy/source-size-check.js";
import { checkSevereSourceFileSizeForRun } from "#modules/autonomy/source-size-review-artifact.js";
import { checkModuleBoundary } from "./project-repair-checks.js";
import {
  checkSuccessCriteriaDeclared,
  checkSuccessCriteriaVerified,
} from "./success-criteria-repair-checks.js";
import type { BuilderTaskReviewContract } from "./task-contract.js";
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
      kind: "autonomy-change-decision";
      projectDir: string;
      runDirPath: string;
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
      kind: "observability-obligation";
      projectDir: string;
      runDirPath: string;
    }
  | {
      kind: "repo-hygiene";
      projectDir: string;
    }
  | {
      kind: "source-file-size-severe";
      projectDir: string;
      runDirPath: string;
    }
  | {
      kind: "source-file-size";
      projectDir: string;
    }
  | {
      kind: "success-criteria-declared";
      projectDir: string;
      runDirPath: string;
      taskContract?: BuilderTaskReviewContract;
    }
  | {
      kind: "success-criteria-verified";
      runDirPath: string;
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
  if (input.kind === "autonomy-change-decision") {
    return captureRepairCheck(() =>
      checkAutonomyChangeDecisionForRun(input.projectDir, input.runDirPath)
    );
  }
  if (input.kind === "doc-bloat") {
    return captureRepairCheck(() => checkDocBloat(input.projectDir));
  }
  if (input.kind === "module-boundary") {
    return captureRepairCheck(() => checkModuleBoundary(input.projectDir));
  }
  if (input.kind === "observability-obligation") {
    return captureRepairCheck(() =>
      checkObservabilityObligationsForRun(input.projectDir, input.runDirPath)
    );
  }
  if (input.kind === "repo-hygiene") {
    return captureRepairCheck(() => checkRepoHygiene(input.projectDir));
  }
  if (input.kind === "source-file-size-severe") {
    return captureRepairCheck(() =>
      checkSevereSourceFileSizeForRun(input.projectDir, input.runDirPath)
    );
  }
  if (input.kind === "source-file-size") {
    return captureRepairCheck(() => checkSourceFileSize(input.projectDir));
  }
  if (input.kind === "success-criteria-declared") {
    return captureRepairCheck(() =>
      checkSuccessCriteriaDeclared(
        input.runDirPath,
        input.projectDir,
        input.taskContract,
      )
    );
  }
  if (input.kind === "success-criteria-verified") {
    return captureRepairCheck(() =>
      checkSuccessCriteriaVerified(input.runDirPath)
    );
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
