import {
  type BuildQualityStratificationReportInput,
  buildQualityObservations,
} from "./quality-stratification-observations.js";
import { buildQualityStratificationSummary } from "./quality-stratification-summary.js";

export type {
  QualityCompositionShift,
  QualityMissingDimensionCount,
  QualityRate,
  QualityReference,
  QualitySignal,
  QualitySignalAggregate,
  QualityStratificationDimension,
  QualityStratificationReport,
  QualityStratificationSlice,
} from "./quality-stratification-types.js";
export type { BuildQualityStratificationReportInput };

export function buildQualityStratificationReport(
  input: BuildQualityStratificationReportInput,
) {
  return buildQualityStratificationSummary(buildQualityObservations(input));
}
