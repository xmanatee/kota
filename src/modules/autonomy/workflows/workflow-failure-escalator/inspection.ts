import { join } from "node:path";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  DEFAULT_CONSECUTIVE_FAILURE_RUNS,
  DEFAULT_FAILURE_RATE_MIN_RUNS,
  DEFAULT_FAILURE_RATE_MIN_WINDOW_MS,
  DEFAULT_REPEATED_WARNING_RUNS,
  detectPersistentWorkflowFailurePatterns,
  type WorkflowFailurePattern,
} from "#modules/autonomy/workflow-failure-escalation.js";

export type WorkflowFailureThresholds = {
  consecutiveFailureRuns: number;
  failureRateMinRuns: number;
  failureRateMinWindowMs: number;
  repeatedWarningRuns: number;
};

export type WorkflowFailureInspection = {
  dirty: boolean;
  status: "dirty" | "none" | "patterns-detected";
  patterns: WorkflowFailurePattern[];
  thresholds: WorkflowFailureThresholds;
};

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isSafeInteger(raw) || raw <= 0) return fallback;
  return raw;
}

export function inspectWorkflowFailurePatternsInWorker(input: {
  projectDir: string;
}): WorkflowFailureInspection {
  const worktree = getRepoWorktreeStatus(input.projectDir);
  const dirty = worktree.available && worktree.dirty;
  const thresholds = {
    consecutiveFailureRuns: readPositiveIntegerEnv(
      "KOTA_WORKFLOW_FAILURE_CONSECUTIVE_RUNS",
      DEFAULT_CONSECUTIVE_FAILURE_RUNS,
    ),
    failureRateMinRuns: readPositiveIntegerEnv(
      "KOTA_WORKFLOW_FAILURE_RATE_MIN_RUNS",
      DEFAULT_FAILURE_RATE_MIN_RUNS,
    ),
    failureRateMinWindowMs:
      readPositiveIntegerEnv(
        "KOTA_WORKFLOW_FAILURE_RATE_MIN_DAYS",
        DEFAULT_FAILURE_RATE_MIN_WINDOW_MS / (24 * 60 * 60 * 1000),
      ) *
      24 *
      60 *
      60 *
      1000,
    repeatedWarningRuns: readPositiveIntegerEnv(
      "KOTA_WORKFLOW_FAILURE_WARNING_RUNS",
      DEFAULT_REPEATED_WARNING_RUNS,
    ),
  };
  const patterns = detectPersistentWorkflowFailurePatterns(
    join(input.projectDir, ".kota", "runs"),
    thresholds,
  );
  return {
    dirty,
    status: dirty
      ? "dirty"
      : patterns.length > 0
        ? "patterns-detected"
        : "none",
    patterns,
    thresholds,
  };
}

export const inspectWorkflowFailurePatternsOperation =
  defineWorkflowBlockingOperation<
    { projectDir: string },
    WorkflowFailureInspection
  >(import.meta.url, "inspectWorkflowFailurePatternsInWorker");
