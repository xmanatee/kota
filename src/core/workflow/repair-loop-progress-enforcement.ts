import type { RepairCheckResult } from "./repair-loop-checks.js";
import {
  type RepairProgressSnapshot,
  repairProgressSnapshot,
} from "./repair-loop-progress.js";
import {
  RepairLoopError,
  type RepairLoopFailureOutput,
} from "./repair-loop-types.js";

const REPAIR_NO_PROGRESS_LIMIT = 3;

export function enforceRepairProgress(args: {
  workspaceDir: string;
  failures: RepairCheckResult[];
  previousProgress: RepairProgressSnapshot;
  noProgressAttempts: number;
  stepId: string;
  failureOutput: RepairLoopFailureOutput;
}): {
  previousProgress: RepairProgressSnapshot;
  noProgressAttempts: number;
} {
  const progress = repairProgressSnapshot(args.workspaceDir, args.failures);
  const madeProgress = progress.key !== args.previousProgress.key;
  const noProgressAttempts = madeProgress ? 0 : args.noProgressAttempts + 1;
  if (noProgressAttempts >= REPAIR_NO_PROGRESS_LIMIT) {
    throw new RepairLoopError(
      "repair-no-progress",
      args.stepId,
      progress.failureIds,
      args.failureOutput,
      `Repair loop for step "${args.stepId}" made no progress after ${REPAIR_NO_PROGRESS_LIMIT} consecutive attempts. ` +
        `Still failing: ${progress.failureIds.join(", ")}`,
    );
  }
  return {
    previousProgress: madeProgress ? progress : args.previousProgress,
    noProgressAttempts,
  };
}
