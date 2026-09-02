import type { WorkflowRunStatus } from "#core/workflow/run-types.js";
import type { RepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";

export const EVALUATOR_CALIBRATION_ARTIFACT = "evaluator-calibration.json";
export const EVALUATOR_CALIBRATION_DISPOSITIONS_ARTIFACT =
  "evaluator-calibration-dispositions.json";
export const EVALUATOR_CALIBRATION_STEP_ID = "write-calibration-artifact";

/**
 * Repair-check id of the critic. A failure means the critic found something
 * the builder repaired before publication; it is diagnostic iteration evidence.
 */
export const CRITIC_CHECK_ID = "critic-review";

export type EvaluatorCalibrationVerdict =
  | "pass"
  | "pass_with_warnings"
  | "fail"
  | "absent";

/** Raw evaluator signals derived after a builder run completes. */
export type EvaluatorCalibrationArtifact = {
  runId: string;
  workflow: string;
  completedAt: string;
  verdict: EvaluatorCalibrationVerdict;
  warningCount: number;
  criticalIssueCount: number;
  repairIterations: number;
  /**
   * Checks repaired in the final iteration. A non-converging build never
   * writes this artifact, so these are diagnostic rather than failure signals.
   */
  finalIterationFailures: string[];
  /**
   * Iterations where the critic rejected a draft that was later repaired.
   * Contradiction detection requires a later overlapping final failure.
   */
  criticFailureCount: number;
  terminalRunStatus: WorkflowRunStatus | "running";
  taskId: string | null;
  taskFinalState: RepoTaskState | null;
  /** Git revision anchoring the reviewed workspace (result commit or failed-run base). */
  sourceRevision: string | null;
  /** Source paths touched by the run, excluding tasks and AGENTS bookkeeping. */
  sourceFilesChanged: string[];
  /** Hash of the active critic prompt; prompt changes reset the sample window. */
  criticPromptHash: string;
};

export type EvaluatorCalibrationRunIdentity = {
  runId: string;
  taskId: string | null;
  sourceRevision: string | null;
};

export type EvaluatorCalibrationContradictionDisposition =
  | {
      kind: "reclassified";
      verdict: "pass_with_warnings" | "fail";
      rationale: string;
      decidedAt: string;
    }
  | {
      kind: "accepted-overlap";
      rationale: string;
      decidedAt: string;
    }
  | {
      kind: "corrective-task";
      taskId: string;
      rationale: string;
      decidedAt: string;
    };

/** One counted pass contradiction and the exact follow-up that established it. */
export type EvaluatorCalibrationContradiction = {
  base: EvaluatorCalibrationRunIdentity;
  later: EvaluatorCalibrationRunIdentity;
  laterFailure: {
    verdict: EvaluatorCalibrationVerdict;
    terminalRunStatus: WorkflowRunStatus | "running";
  };
  overlappingSourcePaths: string[];
  disposition: EvaluatorCalibrationContradictionDisposition | null;
};

export type EvaluatorCalibrationDispositionRecord = {
  base: {
    runId: string;
    sourceRevision: string;
  };
  later: {
    runId: string;
    sourceRevision: string;
  };
  disposition: EvaluatorCalibrationContradictionDisposition;
};

export type EvaluatorCalibrationUnavailableSource = {
  sourceRef: string;
  expectedContradictionCount: number;
  reason: string;
  checkedAt: string;
};

/**
 * Sidecar evidence written by a later review. Historical verdict artifacts
 * stay immutable; records bind the disposition to both run revisions.
 */
export type EvaluatorCalibrationDispositionsArtifact = {
  schemaVersion: 1;
  records: EvaluatorCalibrationDispositionRecord[];
  unavailableSources: EvaluatorCalibrationUnavailableSource[];
};

export type EvaluatorCalibrationAggregate = {
  windowStartMs: number;
  windowEndMs: number;
  totalRuns: number;
  byVerdict: Record<EvaluatorCalibrationVerdict, number>;
  /** Passes followed by an overlapping run with a final failure signal. */
  passContradictionCount: number;
  passContradictionRate: number;
  passContradictions: EvaluatorCalibrationContradiction[];
  /** Hedged verdicts followed by another overlapping hedging/failing run. */
  passWithWarningsFollowUpCount: number;
  passWithWarningsFollowUpRate: number;
};

export type CalibrationDriftKind =
  | "pass-contradiction"
  | "pass-with-warnings-escalation";

export type CalibrationGateConfig = {
  thresholdRate: number;
  minSample: number;
  /** PWW overlap is naturally common, so it uses a separate higher threshold. */
  passWithWarningsThresholdRate: number;
  passWithWarningsMinSample: number;
};

export type CalibrationGateDecision =
  | { status: "insufficient-sample"; reason: string }
  | { status: "under-threshold"; reason: string }
  | { status: "gated"; reason: string; kinds: CalibrationDriftKind[] };

export const DEFAULT_CALIBRATION_THRESHOLD_RATE = 0.25;
/**
 * Small pass samples made individual overlaps move the rate by 10–12.5 points:
 * live 8–10-pass windows repeatedly gated at 30–44%, while the preserved
 * 73–74-pass windows held at 2.7%. Twenty passes keeps the unchanged 25% rate
 * meaningful without treating early-window volatility as evaluator drift.
 */
export const DEFAULT_CALIBRATION_MIN_SAMPLE = 20;
/**
 * Historical PWW overlap was about 70% across a clean seven-day window, so
 * 75% leaves headroom for shared-file churn while surfacing sustained hedging.
 */
export const DEFAULT_PASS_WITH_WARNINGS_THRESHOLD_RATE = 0.75;
export const DEFAULT_PASS_WITH_WARNINGS_MIN_SAMPLE = 5;
