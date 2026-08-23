import type { CalibrationGateConfig } from "./evaluator-calibration-types.js";
import {
  DEFAULT_CALIBRATION_MIN_SAMPLE,
  DEFAULT_CALIBRATION_THRESHOLD_RATE,
  DEFAULT_PASS_WITH_WARNINGS_MIN_SAMPLE,
  DEFAULT_PASS_WITH_WARNINGS_THRESHOLD_RATE,
} from "./evaluator-calibration-types.js";

type CalibrationConfigEnvironment = Readonly<
  Record<string, string | undefined>
>;

function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Resolve the exact gate configuration shared by the monitor and repair evidence. */
export function resolveCalibrationGateConfig(
  env: CalibrationConfigEnvironment = process.env,
): CalibrationGateConfig {
  return {
    thresholdRate: positiveNumber(
      env.KOTA_EVALUATOR_CALIBRATION_THRESHOLD_RATE,
      DEFAULT_CALIBRATION_THRESHOLD_RATE,
    ),
    minSample: Math.floor(
      positiveNumber(
        env.KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE,
        DEFAULT_CALIBRATION_MIN_SAMPLE,
      ),
    ),
    passWithWarningsThresholdRate: positiveNumber(
      env.KOTA_EVALUATOR_CALIBRATION_PWW_THRESHOLD_RATE,
      DEFAULT_PASS_WITH_WARNINGS_THRESHOLD_RATE,
    ),
    passWithWarningsMinSample: Math.floor(
      positiveNumber(
        env.KOTA_EVALUATOR_CALIBRATION_PWW_MIN_SAMPLE,
        DEFAULT_PASS_WITH_WARNINGS_MIN_SAMPLE,
      ),
    ),
  };
}
