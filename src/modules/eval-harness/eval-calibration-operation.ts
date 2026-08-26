import { join } from "node:path";
import { getCriticPromptHash } from "#modules/autonomy/critic.js";
import {
  aggregateCalibration,
  DEFAULT_CALIBRATION_MIN_SAMPLE,
  DEFAULT_CALIBRATION_THRESHOLD_RATE,
  DEFAULT_PASS_WITH_WARNINGS_MIN_SAMPLE,
  DEFAULT_PASS_WITH_WARNINGS_THRESHOLD_RATE,
  evaluateCalibrationGate,
} from "#modules/autonomy/evaluator-calibration.js";
import type {
  EvalCalibrationOptions,
  EvalCalibrationResult,
} from "./client.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function runEvalCalibration(
  workspaceRoot: string,
  options: EvalCalibrationOptions = {},
): EvalCalibrationResult {
  const windowDays = options.windowDays ?? 7;
  const followUpDays = options.followUpDays ?? 3;
  const thresholdRate = options.thresholdRate ?? DEFAULT_CALIBRATION_THRESHOLD_RATE;
  const minSample = options.minSample ?? DEFAULT_CALIBRATION_MIN_SAMPLE;
  const runsDir = options.runsDir ?? join(workspaceRoot, ".kota", "runs");

  const aggregate = aggregateCalibration(runsDir, {
    windowMs: windowDays * DAY_MS,
    followUpWindowMs: followUpDays * DAY_MS,
    criticPromptHash: getCriticPromptHash(),
  });
  const decision = evaluateCalibrationGate(aggregate, {
    thresholdRate,
    minSample,
    passWithWarningsThresholdRate: DEFAULT_PASS_WITH_WARNINGS_THRESHOLD_RATE,
    passWithWarningsMinSample: DEFAULT_PASS_WITH_WARNINGS_MIN_SAMPLE,
  });
  return {
    aggregate,
    decision,
  };
}
