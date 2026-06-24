import type { ReviewScrutinyReport } from "#modules/autonomy/review-scrutiny.js";
import { isApprovalLikeDecision } from "#modules/autonomy/review-scrutiny-types.js";
import {
  mergeDimensions,
  runDimensions,
  taskDimensions,
} from "./quality-stratification-dimensions.js";
import type { QualityRunIndexes } from "./quality-stratification-run-indexes.js";
import type {
  QualityBucket,
  QualityObservation,
} from "./quality-stratification-types.js";

export function buildReviewQualityObservations(
  report: ReviewScrutinyReport,
  bucket: QualityBucket,
  indexes: QualityRunIndexes,
): QualityObservation[] {
  return report.records.map((record) => {
    const run = indexes.runById.get(record.runId);
    const task = record.taskId ? indexes.taskById.get(record.taskId) : undefined;
    return {
      signal: "review-scrutiny",
      bucket,
      denominator: isApprovalLikeDecision(record.decision),
      numerator: record.thinAcceptance,
      dimensions: mergeDimensions(
        {
          workflow: [record.workflow],
          reviewSurface: [record.surface],
        },
        run ? runDimensions(run, indexes) : {},
        task ? taskDimensions(task) : {},
      ),
      reference: {
        runId: record.runId,
        taskId: record.taskId,
        artifact: record.artifact,
      },
    };
  });
}
