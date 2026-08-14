import { describe, expect, it } from "vitest";
import {
  DEFAULT_CALIBRATION_MIN_SAMPLE,
  DEFAULT_CALIBRATION_THRESHOLD_RATE,
  DEFAULT_PASS_WITH_WARNINGS_MIN_SAMPLE,
  DEFAULT_PASS_WITH_WARNINGS_THRESHOLD_RATE,
  resolveCalibrationGateConfig,
} from "./evaluator-calibration.js";

describe("resolveCalibrationGateConfig", () => {
  it("propagates the canonical defaults when no override is present", () => {
    expect(resolveCalibrationGateConfig({})).toEqual({
      thresholdRate: DEFAULT_CALIBRATION_THRESHOLD_RATE,
      minSample: DEFAULT_CALIBRATION_MIN_SAMPLE,
      passWithWarningsThresholdRate:
        DEFAULT_PASS_WITH_WARNINGS_THRESHOLD_RATE,
      passWithWarningsMinSample: DEFAULT_PASS_WITH_WARNINGS_MIN_SAMPLE,
    });
  });

  it("normalizes positive environment overrides and rejects invalid ones", () => {
    expect(
      resolveCalibrationGateConfig({
        KOTA_EVALUATOR_CALIBRATION_THRESHOLD_RATE: "0.4",
        KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE: "24.9",
        KOTA_EVALUATOR_CALIBRATION_PWW_THRESHOLD_RATE: "invalid",
        KOTA_EVALUATOR_CALIBRATION_PWW_MIN_SAMPLE: "0",
      }),
    ).toEqual({
      thresholdRate: 0.4,
      minSample: 24,
      passWithWarningsThresholdRate:
        DEFAULT_PASS_WITH_WARNINGS_THRESHOLD_RATE,
      passWithWarningsMinSample: DEFAULT_PASS_WITH_WARNINGS_MIN_SAMPLE,
    });
  });
});
