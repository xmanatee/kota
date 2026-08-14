import { join } from "node:path";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { getCriticPromptHash } from "#modules/autonomy/critic.js";
import {
  aggregateCalibration,
  type CalibrationDriftKind,
  DEFAULT_CALIBRATION_MIN_SAMPLE,
  DEFAULT_CALIBRATION_THRESHOLD_RATE,
  DEFAULT_PASS_WITH_WARNINGS_MIN_SAMPLE,
  DEFAULT_PASS_WITH_WARNINGS_THRESHOLD_RATE,
  type EvaluatorCalibrationAggregate,
  evaluateCalibrationGate,
} from "#modules/autonomy/evaluator-calibration.js";

export type EvaluatorCalibrationInspection = {
  dirty: boolean;
  status: "insufficient-sample" | "under-threshold" | "gated";
  reason: string;
  driftKinds: CalibrationDriftKind[];
  thresholdRate: number;
  passWithWarningsThresholdRate: number;
  aggregate: EvaluatorCalibrationAggregate;
};

function readNumberEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return raw;
}

export function inspectEvaluatorCalibrationInWorker(input: {
  projectDir: string;
}): EvaluatorCalibrationInspection {
  const worktree = getRepoWorktreeStatus(input.projectDir);
  const dirty = worktree.available && worktree.dirty;
  const config = {
    thresholdRate: readNumberEnv(
      "KOTA_EVALUATOR_CALIBRATION_THRESHOLD_RATE",
      DEFAULT_CALIBRATION_THRESHOLD_RATE,
    ),
    minSample: Math.floor(
      readNumberEnv(
        "KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE",
        DEFAULT_CALIBRATION_MIN_SAMPLE,
      ),
    ),
    passWithWarningsThresholdRate: readNumberEnv(
      "KOTA_EVALUATOR_CALIBRATION_PWW_THRESHOLD_RATE",
      DEFAULT_PASS_WITH_WARNINGS_THRESHOLD_RATE,
    ),
    passWithWarningsMinSample: Math.floor(
      readNumberEnv(
        "KOTA_EVALUATOR_CALIBRATION_PWW_MIN_SAMPLE",
        DEFAULT_PASS_WITH_WARNINGS_MIN_SAMPLE,
      ),
    ),
  };
  const aggregate = aggregateCalibration(
    join(input.projectDir, ".kota", "runs"),
    { criticPromptHash: getCriticPromptHash() },
  );
  const decision = evaluateCalibrationGate(aggregate, config);
  return {
    dirty,
    status: decision.status,
    reason: decision.reason,
    driftKinds: decision.status === "gated" ? decision.kinds : [],
    thresholdRate: config.thresholdRate,
    passWithWarningsThresholdRate: config.passWithWarningsThresholdRate,
    aggregate,
  };
}

export const inspectEvaluatorCalibrationOperation =
  defineWorkflowBlockingOperation<
    { projectDir: string },
    EvaluatorCalibrationInspection
  >(import.meta.url, "inspectEvaluatorCalibrationInWorker");
