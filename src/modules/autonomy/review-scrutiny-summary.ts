import {
  CRITIC_REVIEW_ARTIFACT,
  isApprovalLikeDecision,
  PROGRESS_REVIEW_ARTIFACT,
  type ReviewScrutinyRecord,
  type ReviewScrutinyReport,
  type ReviewScrutinyUnsupportedArtifact,
  type ReviewSurface,
  SEMANTIC_GATE_REVIEW_ARTIFACT,
  SUPPORTED_REVIEW_SURFACES,
} from "./review-scrutiny-types.js";

export function summarizeReviewScrutiny(
  records: ReviewScrutinyRecord[],
  unsupported: ReviewScrutinyUnsupportedArtifact[],
): ReviewScrutinyReport {
  const bySurface = SUPPORTED_REVIEW_SURFACES.map((surface) => {
    const surfaceRecords = records.filter((record) => record.surface === surface);
    const unsupportedArtifacts = unsupported.filter((item) =>
      surfaceForArtifact(item.artifact) === surface,
    ).length;
    return {
      surface,
      reviews: surfaceRecords.length,
      approvalLikeDecisions: surfaceRecords.filter((record) =>
        isApprovalLikeDecision(record.decision)
      ).length,
      thinAcceptances: surfaceRecords.filter((record) => record.thinAcceptance).length,
      absentMetricCount: surfaceRecords.reduce(
        (total, record) => total + record.absentMetrics.length,
        0,
      ),
      unsupportedArtifacts,
    };
  });
  const thinAcceptanceRefs = records
    .filter((record) => record.thinAcceptance)
    .map((record) => ({
      runId: record.runId,
      workflow: record.workflow,
      surface: record.surface,
      decision: record.decision,
      artifact: record.artifact,
      ...(record.taskId ? { taskId: record.taskId } : {}),
      ...(record.pr ? { pr: record.pr } : {}),
    }));
  const absentMetricRefs = records
    .filter((record) => record.absentMetrics.length > 0)
    .map((record) => ({
      runId: record.runId,
      workflow: record.workflow,
      surface: record.surface,
      artifact: record.artifact,
      metrics: record.absentMetrics,
      ...(record.taskId ? { taskId: record.taskId } : {}),
      ...(record.pr ? { pr: record.pr } : {}),
    }));
  return {
    totalReviews: records.length,
    approvalLikeDecisions: records.filter((record) =>
      isApprovalLikeDecision(record.decision)
    ).length,
    thinAcceptances: thinAcceptanceRefs.length,
    absentMetricCount: absentMetricRefs.reduce(
      (total, ref) => total + ref.metrics.length,
      0,
    ),
    unsupportedArtifacts: unsupported.length,
    bySurface,
    thinAcceptanceRefs,
    absentMetricRefs,
    records,
    unsupported,
  };
}

function surfaceForArtifact(artifact: string): ReviewSurface {
  if (artifact === CRITIC_REVIEW_ARTIFACT) return "critic";
  if (artifact === SEMANTIC_GATE_REVIEW_ARTIFACT) return "semantic-gate";
  if (artifact === PROGRESS_REVIEW_ARTIFACT) return "progress-reviewer";
  return "pr-reviewer";
}
