/**
 * Public facade for live-run evaluator calibration.
 *
 * Artifact derivation and rolling-window aggregation are separate so their
 * lifecycle and drift semantics remain independently reviewable.
 */

export {
  type AggregateCalibrationOptions,
  aggregateCalibration,
  evaluateCalibrationGate,
} from "./evaluator-calibration-aggregate.js";
export {
  type WriteCalibrationArtifactOptions,
  writeCalibrationArtifact,
} from "./evaluator-calibration-artifact.js";
export { resolveCalibrationGateConfig } from "./evaluator-calibration-config.js";
export {
  type CalibrationDriftKind,
  type CalibrationGateConfig,
  type CalibrationGateDecision,
  CRITIC_CHECK_ID,
  DEFAULT_CALIBRATION_MIN_SAMPLE,
  DEFAULT_CALIBRATION_THRESHOLD_RATE,
  DEFAULT_PASS_WITH_WARNINGS_MIN_SAMPLE,
  DEFAULT_PASS_WITH_WARNINGS_THRESHOLD_RATE,
  EVALUATOR_CALIBRATION_ARTIFACT,
  EVALUATOR_CALIBRATION_STEP_ID,
  type EvaluatorCalibrationAggregate,
  type EvaluatorCalibrationArtifact,
  type EvaluatorCalibrationVerdict,
} from "./evaluator-calibration-types.js";
