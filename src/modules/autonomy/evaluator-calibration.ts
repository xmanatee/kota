/**
 * Live-run evaluator calibration tracking.
 *
 * Records, per builder run, how the critic's final verdict lines up with
 * downstream evidence already produced by that run: whether the repair loop
 * ultimately accepted the agent's work, what terminal state the task reached,
 * and which files changed (so later aggregation can detect follow-up fix
 * runs on the same paths).
 *
 * Aggregate calibration is derivable from these artifacts without per-run
 * human annotation. Aggregation reads artifacts in a rolling window and
 * never mutates them. This surface is additive to the eval-harness fixture
 * cadence: fixtures catch generator drift against fixed outcomes; this
 * surface catches evaluator drift on live runs.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readOptionalJsonFile, writeJsonFileAtomic } from "#core/util/json-file.js";
import { readRepairIterations } from "#core/workflow/repair-iteration-output.js";
import type {
  WorkflowRunStatus,
  WorkflowStepContext,
} from "#core/workflow/run-types.js";
import { REPO_TASKS_DIR, type RepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { CriticVerdict } from "./critic.js";

export const EVALUATOR_CALIBRATION_ARTIFACT = "evaluator-calibration.json";

/** Discrete verdict values the calibration signal tracks. */
export type EvaluatorCalibrationVerdict =
  | "pass"
  | "pass_with_warnings"
  | "fail"
  | "absent";

/**
 * Per-run calibration artifact. Written once after a builder run commits,
 * alongside `run-summary.json`. Follow-up detection is layered on during
 * aggregation — the artifact intentionally records raw signals that aggregation
 * can compare against later runs.
 */
export type EvaluatorCalibrationArtifact = {
  runId: string;
  workflow: string;
  completedAt: string;
  verdict: EvaluatorCalibrationVerdict;
  warningCount: number;
  criticalIssueCount: number;
  repairIterations: number;
  /**
   * Ids of checks that failed on the final repair iteration. Empty when the
   * build step ultimately succeeded, non-empty when a downstream check still
   * failed after the critic ran.
   */
  finalIterationFailures: string[];
  terminalRunStatus: WorkflowRunStatus | "running";
  taskId: string | null;
  taskFinalState: RepoTaskState | null;
  /**
   * Source file paths touched by the run (excluding task files and AGENTS.md
   * bookkeeping). Aggregation uses these as the follow-up fingerprint.
   */
  sourceFilesChanged: string[];
};

export type EvaluatorCalibrationAggregate = {
  windowStartMs: number;
  windowEndMs: number;
  totalRuns: number;
  byVerdict: Record<EvaluatorCalibrationVerdict, number>;
  /**
   * Pass verdicts contradicted by downstream evidence: a later builder run
   * within the follow-up window touched overlapping source files AND that
   * later run itself carried a failure signal (critic verdict `fail`, or a
   * non-empty `finalIterationFailures` — its repair loop did not converge).
   * Overlap alone is not enough: healthy chains of related refactors
   * repeatedly touch the same files while still passing, and that shape is
   * not evaluator drift.
   */
  passContradictionCount: number;
  passContradictionRate: number;
  /**
   * Pass-with-warnings verdicts correlated with any later overlapping run.
   * Surfaces separately from pass-contradiction: the critic already hedged,
   * so overlap alone (regardless of the later run's own outcome) is a useful
   * operator signal here.
   */
  passWithWarningsFollowUpCount: number;
  passWithWarningsFollowUpRate: number;
};

/**
 * Calibration drift kinds the monitor distinguishes when escalating to a
 * repair task. Pass-contradiction = critic said pass but a later overlapping
 * run failed (the historic gate). Pass-with-warnings escalation = the critic
 * keeps hedging on overlapping work — the warnings already accepted as
 * "remember this later" are recurring, which the task contract requires us to
 * surface separately so it does not stay a notification-only signal.
 */
export type CalibrationDriftKind =
  | "pass-contradiction"
  | "pass-with-warnings-escalation";

export type CalibrationGateConfig = {
  thresholdRate: number;
  minSample: number;
  /**
   * Threshold for the pass-with-warnings escalation kind. Pass-with-warnings
   * follow-up correlates an already-hedged verdict with any later overlapping
   * run, so the bar is intentionally higher than for pass contradictions.
   */
  passWithWarningsThresholdRate: number;
  /** Minimum pass-with-warnings sample before the escalation kind can fire. */
  passWithWarningsMinSample: number;
};

export type CalibrationGateDecision =
  | { status: "insufficient-sample"; reason: string }
  | { status: "under-threshold"; reason: string }
  | { status: "gated"; reason: string; kinds: CalibrationDriftKind[] };

const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_FOLLOW_UP_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
export const DEFAULT_CALIBRATION_THRESHOLD_RATE = 0.25;
export const DEFAULT_CALIBRATION_MIN_SAMPLE = 8;
export const DEFAULT_PASS_WITH_WARNINGS_THRESHOLD_RATE = 0.4;
export const DEFAULT_PASS_WITH_WARNINGS_MIN_SAMPLE = 5;

function readCriticVerdict(runDir: string): CriticVerdict | null {
  const path = join(runDir, "critic-review.json");
  const parsed = readOptionalJsonFile<CriticVerdict>(path);
  if (!parsed) return null;
  if (
    parsed.verdict !== "pass" &&
    parsed.verdict !== "pass_with_warnings" &&
    parsed.verdict !== "fail"
  ) {
    return null;
  }
  return {
    verdict: parsed.verdict,
    critical_issues: Array.isArray(parsed.critical_issues) ? parsed.critical_issues : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
  };
}

const AGENTS_BOOKKEEPING_SUFFIX = "AGENTS.md";
const TASK_PATH_PREFIX = `${REPO_TASKS_DIR}/`;

function isSourceFile(path: string): boolean {
  if (path.endsWith(AGENTS_BOOKKEEPING_SUFFIX)) return false;
  if (path.startsWith(TASK_PATH_PREFIX)) return false;
  return true;
}

type FindTaskFinalState = (
  projectDir: string,
  taskId: string,
) => RepoTaskState | null;

function defaultFindTaskFinalState(
  projectDir: string,
  taskId: string,
): RepoTaskState | null {
  const states: RepoTaskState[] = [
    "done",
    "dropped",
    "blocked",
    "doing",
    "ready",
    "backlog",
  ];
  for (const state of states) {
    const candidate = join(projectDir, TASK_PATH_PREFIX, state, `${taskId}.md`);
    if (existsSync(candidate)) return state;
  }
  return null;
}

export type WriteCalibrationArtifactOptions = {
  agentStepId?: string;
  findTaskFinalState?: FindTaskFinalState;
};

/**
 * Compose and persist the calibration artifact for a finished builder run.
 * Reads from run-summary.json + critic-review.json + the run metadata so the
 * signal is fully derived from artifacts other parts of the workflow already
 * wrote. Safe to call after writeBuilderRunSummary; returns the artifact
 * that was persisted.
 */
export function writeCalibrationArtifact(
  ctx: WorkflowStepContext,
  options: WriteCalibrationArtifactOptions = {},
): EvaluatorCalibrationArtifact {
  const agentStepId = options.agentStepId ?? "build";
  const findTaskFinalState = options.findTaskFinalState ?? defaultFindTaskFinalState;

  const runDir = ctx.workflow.runDirPath;
  const runSummary = readOptionalJsonFile<{
    runId: string;
    workflow: string;
    taskId: string | null;
    filesChanged: string[];
    completedAt: string;
  }>(join(runDir, "run-summary.json"));

  const criticVerdict = readCriticVerdict(runDir);
  const verdict: EvaluatorCalibrationVerdict = criticVerdict?.verdict ?? "absent";
  const warningCount = criticVerdict?.warnings.length ?? 0;
  const criticalIssueCount = criticVerdict?.critical_issues.length ?? 0;

  const buildOutput = ctx.stepOutputs[agentStepId];
  const iterations = readRepairIterations(buildOutput);
  const lastIteration = iterations.at(-1);
  const finalIterationFailures = lastIteration
    ? lastIteration.failures.map((f) => f.id)
    : [];

  // At the time this step runs, the build step has already completed and the
  // workflow has committed — the only remaining steps write summary + emit
  // follow-up events. If the build step failed, this writer is gated off by
  // its `when: stepSucceeded("write-run-summary")` predicate, so recording
  // "success" here matches the observable terminal state of the run.
  const terminalRunStatus: WorkflowRunStatus | "running" =
    ctx.stepResults[agentStepId]?.status === "success" ? "success" : "running";
  const taskId = runSummary?.taskId ?? null;
  const taskFinalState = taskId ? findTaskFinalState(ctx.projectDir, taskId) : null;

  const filesChanged = runSummary?.filesChanged ?? [];
  const sourceFilesChanged = filesChanged.filter(isSourceFile);

  const artifact: EvaluatorCalibrationArtifact = {
    runId: ctx.workflow.runId,
    workflow: ctx.workflow.name,
    completedAt: runSummary?.completedAt ?? new Date().toISOString(),
    verdict,
    warningCount,
    criticalIssueCount,
    repairIterations: iterations.length,
    finalIterationFailures,
    terminalRunStatus,
    taskId,
    taskFinalState,
    sourceFilesChanged,
  };

  writeJsonFileAtomic(join(runDir, EVALUATOR_CALIBRATION_ARTIFACT), artifact);
  return artifact;
}

export type AggregateCalibrationOptions = {
  /** Primary window. Runs outside this window are ignored. */
  windowMs?: number;
  /** How far after a base run to look for follow-up overlap. */
  followUpWindowMs?: number;
  /** Deterministic clock override for tests. */
  nowMs?: number;
};

type LoadedArtifact = {
  runDir: string;
  completedAtMs: number;
  artifact: EvaluatorCalibrationArtifact;
};

function loadCalibrationArtifactsInWindow(
  runsDir: string,
  windowMs: number,
  nowMs: number,
): LoadedArtifact[] {
  if (!existsSync(runsDir)) return [];
  const entries = readdirSync(runsDir).sort();
  const cutoffMs = nowMs - windowMs;
  const loaded: LoadedArtifact[] = [];
  for (const entry of entries) {
    const runDir = join(runsDir, entry);
    const artifact = readOptionalJsonFile<EvaluatorCalibrationArtifact>(
      join(runDir, EVALUATOR_CALIBRATION_ARTIFACT),
    );
    if (!artifact) continue;
    const completedAtMs = Date.parse(artifact.completedAt);
    if (!Number.isFinite(completedAtMs)) continue;
    if (completedAtMs < cutoffMs) continue;
    if (completedAtMs > nowMs) continue;
    loaded.push({ runDir, completedAtMs, artifact });
  }
  loaded.sort((a, b) => a.completedAtMs - b.completedAtMs);
  return loaded;
}

function hasFailureSignal(artifact: EvaluatorCalibrationArtifact): boolean {
  if (artifact.verdict === "fail") return true;
  if (artifact.finalIterationFailures.length > 0) return true;
  return false;
}

type FollowUpFilter = (later: EvaluatorCalibrationArtifact) => boolean;

function hasOverlappingFollowUp(
  base: LoadedArtifact,
  later: LoadedArtifact[],
  followUpWindowMs: number,
  accept: FollowUpFilter,
): boolean {
  if (base.artifact.sourceFilesChanged.length === 0) return false;
  const baseFiles = new Set(base.artifact.sourceFilesChanged);
  const deadlineMs = base.completedAtMs + followUpWindowMs;
  for (const candidate of later) {
    if (candidate.completedAtMs <= base.completedAtMs) continue;
    if (candidate.completedAtMs > deadlineMs) break;
    if (!accept(candidate.artifact)) continue;
    for (const file of candidate.artifact.sourceFilesChanged) {
      if (baseFiles.has(file)) return true;
    }
  }
  return false;
}

const acceptAnyFollowUp: FollowUpFilter = () => true;
const acceptFailingFollowUp: FollowUpFilter = hasFailureSignal;

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Walk the run directory and compute a typed aggregate over a rolling window.
 * Follow-up fingerprinting walks forward from each base run up to
 * `followUpWindowMs` looking for overlapping source-file changes. A pass is
 * only counted as contradicted when the later overlapping run itself carries
 * a failure signal — overlap alone is healthy iteration, not evaluator drift.
 * Pass-with-warnings stays on the looser overlap signal since the critic
 * already hedged on those runs.
 */
export function aggregateCalibration(
  runsDir: string,
  options: AggregateCalibrationOptions = {},
): EvaluatorCalibrationAggregate {
  const nowMs = options.nowMs ?? Date.now();
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const followUpWindowMs = options.followUpWindowMs ?? DEFAULT_FOLLOW_UP_WINDOW_MS;

  const artifacts = loadCalibrationArtifactsInWindow(runsDir, windowMs, nowMs);

  const byVerdict: Record<EvaluatorCalibrationVerdict, number> = {
    pass: 0,
    pass_with_warnings: 0,
    fail: 0,
    absent: 0,
  };

  let passContradictionCount = 0;
  let passWithWarningsFollowUpCount = 0;

  for (let i = 0; i < artifacts.length; i++) {
    const entry = artifacts[i];
    const { artifact } = entry;
    byVerdict[artifact.verdict]++;
    const tail = artifacts.slice(i + 1);

    if (artifact.verdict === "pass") {
      if (
        hasOverlappingFollowUp(entry, tail, followUpWindowMs, acceptFailingFollowUp)
      ) {
        passContradictionCount++;
      }
    }
    if (artifact.verdict === "pass_with_warnings") {
      if (hasOverlappingFollowUp(entry, tail, followUpWindowMs, acceptAnyFollowUp)) {
        passWithWarningsFollowUpCount++;
      }
    }
  }

  return {
    windowStartMs: nowMs - windowMs,
    windowEndMs: nowMs,
    totalRuns: artifacts.length,
    byVerdict,
    passContradictionCount,
    passContradictionRate: rate(passContradictionCount, byVerdict.pass),
    passWithWarningsFollowUpCount,
    passWithWarningsFollowUpRate: rate(
      passWithWarningsFollowUpCount,
      byVerdict.pass_with_warnings,
    ),
  };
}

/**
 * Apply the configured gate to an aggregate. The gate fires when either drift
 * kind crosses its configured threshold:
 *
 * - `pass-contradiction`: critic said pass on a run whose later overlapping
 *   follow-up itself failed.
 * - `pass-with-warnings-escalation`: critic kept hedging on overlapping work
 *   — already-accepted warnings are recurring against shared files instead of
 *   being closed out.
 *
 * Each kind requires its own minimum sample to be trustworthy. Both can fire
 * in the same decision so the corrective task can name every drift the run is
 * proposing to fix. `insufficient-sample` only returns when neither kind has
 * enough data, so a healthy pass-contradiction signal still surfaces even if
 * the warnings sample is thin.
 */
export function evaluateCalibrationGate(
  aggregate: EvaluatorCalibrationAggregate,
  config: CalibrationGateConfig,
): CalibrationGateDecision {
  const passCount = aggregate.byVerdict.pass;
  const passWithWarningsCount = aggregate.byVerdict.pass_with_warnings;

  const passSampleAdequate = passCount >= config.minSample;
  const warningSampleAdequate = passWithWarningsCount >= config.passWithWarningsMinSample;

  if (!passSampleAdequate && !warningSampleAdequate) {
    return {
      status: "insufficient-sample",
      reason:
        `Only ${passCount} pass verdicts and ${passWithWarningsCount} pass_with_warnings ` +
        `verdicts in window (minimums ${config.minSample} / ${config.passWithWarningsMinSample}).`,
    };
  }

  const kinds: CalibrationDriftKind[] = [];
  const reasons: string[] = [];

  if (passSampleAdequate) {
    const observed = aggregate.passContradictionRate;
    if (observed > config.thresholdRate) {
      kinds.push("pass-contradiction");
      reasons.push(
        `Pass-verdict contradiction rate ${(observed * 100).toFixed(1)}% ` +
          `exceeds threshold ${(config.thresholdRate * 100).toFixed(1)}% ` +
          `(${aggregate.passContradictionCount} of ${passCount} pass verdicts).`,
      );
    }
  }

  if (warningSampleAdequate) {
    const observed = aggregate.passWithWarningsFollowUpRate;
    if (observed > config.passWithWarningsThresholdRate) {
      kinds.push("pass-with-warnings-escalation");
      reasons.push(
        `Pass-with-warnings follow-up rate ${(observed * 100).toFixed(1)}% ` +
          `exceeds threshold ${(config.passWithWarningsThresholdRate * 100).toFixed(1)}% ` +
          `(${aggregate.passWithWarningsFollowUpCount} of ${passWithWarningsCount} pass_with_warnings verdicts).`,
      );
    }
  }

  if (kinds.length > 0) {
    return {
      status: "gated",
      reason: reasons.join(" "),
      kinds,
    };
  }

  const observed = aggregate.passContradictionRate;
  return {
    status: "under-threshold",
    reason:
      `Pass-verdict contradiction rate ${(observed * 100).toFixed(1)}% ` +
      `within threshold ${(config.thresholdRate * 100).toFixed(1)}%.`,
  };
}
