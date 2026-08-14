import { join } from "node:path";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  DEFAULT_TRAJECTORY_DIAGNOSTIC_PATTERN_RUNS,
  DEFAULT_TRAJECTORY_DIAGNOSTIC_WINDOW_MS,
  detectRecurringTrajectoryDiagnosticPatterns,
  type TrajectoryDiagnosticPattern,
} from "#modules/autonomy/trajectory-diagnostic-escalation.js";

export type TrajectoryDiagnosticThresholds = {
  thresholdRuns: number;
  windowMs: number;
};

export type TrajectoryDiagnosticInspection = {
  dirty: boolean;
  status: "dirty" | "none" | "patterns-detected";
  patterns: TrajectoryDiagnosticPattern[];
  thresholds: TrajectoryDiagnosticThresholds;
};

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isSafeInteger(raw) || raw <= 0) return fallback;
  return raw;
}

export function inspectTrajectoryDiagnosticPatternsInWorker(input: {
  projectDir: string;
}): TrajectoryDiagnosticInspection {
  const worktree = getRepoWorktreeStatus(input.projectDir);
  const dirty = worktree.available && worktree.dirty;
  const thresholdRuns = readPositiveIntegerEnv(
    "KOTA_TRAJECTORY_DIAGNOSTIC_PATTERN_RUNS",
    DEFAULT_TRAJECTORY_DIAGNOSTIC_PATTERN_RUNS,
  );
  const windowMs =
    readPositiveIntegerEnv(
      "KOTA_TRAJECTORY_DIAGNOSTIC_WINDOW_DAYS",
      DEFAULT_TRAJECTORY_DIAGNOSTIC_WINDOW_MS / (24 * 60 * 60 * 1000),
    ) *
    24 *
    60 *
    60 *
    1000;
  const patterns = detectRecurringTrajectoryDiagnosticPatterns(
    join(input.projectDir, ".kota", "runs"),
    { thresholdRuns, windowMs },
  );
  return {
    dirty,
    status: dirty
      ? "dirty"
      : patterns.length > 0
        ? "patterns-detected"
        : "none",
    patterns,
    thresholds: { thresholdRuns, windowMs },
  };
}

export const inspectTrajectoryDiagnosticPatternsOperation =
  defineWorkflowBlockingOperation<
    { projectDir: string },
    TrajectoryDiagnosticInspection
  >(import.meta.url, "inspectTrajectoryDiagnosticPatternsInWorker");
