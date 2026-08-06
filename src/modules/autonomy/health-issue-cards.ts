import {
  type AutonomyIssueDispositionKind,
  type AutonomyIssueStatus,
  readAutonomyIssueProjection,
} from "./autonomy-issue-projection.js";
import type {
  AutonomyHealthActionability,
  AutonomyHealthEvidenceRef,
  AutonomyHealthSeverity,
} from "./health-signal.js";

export type AutonomyHealthIssueCard = {
  issueKey: string;
  status: AutonomyIssueStatus;
  reviewedAt: string;
  dedupeKey: string;
  severity: AutonomyHealthSeverity;
  labels: string[];
  actionability: AutonomyHealthActionability;
  signalCount: number;
  semanticRevision: number;
  disposition: AutonomyIssueDispositionKind;
  summaries: string[];
  evidenceRefs: AutonomyHealthEvidenceRef[];
  taskIds: string[];
  ownerQuestionIds: string[];
  deadLetterIds: string[];
  recoveryDispositionRefs: string[];
};

export type AutonomyHealthIssueEvidence = {
  generatedAt: string;
  projectionUpdatedAt: string | null;
  issueCards: AutonomyHealthIssueCard[];
};

const DEFAULT_CARD_LIMIT = 12;

export function collectCurrentAutonomyHealthIssueCards(
  projectDir: string,
  options: { limit?: number; nowIso?: string } = {},
): AutonomyHealthIssueEvidence {
  const projection = readAutonomyIssueProjection(projectDir);
  const limit = options.limit ?? DEFAULT_CARD_LIMIT;
  const issueCards = projection.issues
    .filter((issue) => issue.status !== "resolved")
    .sort(
      (left, right) =>
        right.lastSeenAt.localeCompare(left.lastSeenAt) ||
        left.issueKey.localeCompare(right.issueKey),
    )
    .slice(0, limit)
    .map((issue): AutonomyHealthIssueCard => ({
      issueKey: issue.issueKey,
      status: issue.status,
      reviewedAt: issue.lastSeenAt,
      dedupeKey: issue.rootCauseKey,
      severity: issue.severity,
      labels: [...issue.labels],
      actionability: issue.actionability,
      signalCount: issue.occurrenceCount,
      semanticRevision: issue.semanticRevision,
      disposition: issue.disposition.kind,
      summaries: [...issue.summaries],
      evidenceRefs: issue.evidenceRefs.map((ref) => ({ ...ref })),
      taskIds: [...issue.links.taskIds],
      ownerQuestionIds: [...issue.links.ownerQuestionIds],
      deadLetterIds: [...issue.links.deadLetterIds],
      recoveryDispositionRefs: [...issue.links.recoveryDispositionRefs],
    }));
  return {
    generatedAt: options.nowIso ?? new Date().toISOString(),
    projectionUpdatedAt: projection.updatedAt,
    issueCards,
  };
}
