import type {
  AutonomyHealthActionability,
  AutonomyHealthEvidenceRef,
  AutonomyHealthObservation,
  AutonomyHealthSeverity,
  AutonomyHealthSignalSource,
} from "./health-signal.js";

export const AUTONOMY_ISSUE_PROJECTION_FILE =
  ".kota/autonomy-issues/projection.json";

export type AutonomyIssueStatus = "open" | "needs-decision" | "resolved";
export type AutonomyIssueTransitionKind =
  | "opened"
  | "repeated"
  | "revised"
  | "cleared"
  | "reopened"
  | "replayed";
export type AutonomyIssueDispositionKind =
  | "needs-decision"
  | "task"
  | "owner-question"
  | "attention"
  | "observed"
  | "resolved"
  | "cleared";

export type AutonomyIssueLinks = {
  taskIds: string[];
  ownerQuestionIds: string[];
  deadLetterIds: string[];
};

export type AutonomyIssueObservation = {
  observationId: string;
  kind: AutonomyHealthObservation;
  issueKey: string;
  rootCauseKey: string;
  observedAt: string;
  source: AutonomyHealthSignalSource;
  severity: AutonomyHealthSeverity;
  actionability: AutonomyHealthActionability;
  labels: string[];
  summaries: string[];
  evidenceRefs: AutonomyHealthEvidenceRef[];
  observationCount: number;
  semanticFingerprint: string;
  links: Pick<AutonomyIssueLinks, "deadLetterIds">;
};

export type AutonomyIssueHistoryEntry = AutonomyIssueObservation & {
  transition: Exclude<AutonomyIssueTransitionKind, "replayed">;
  semanticRevision: number;
};

export type AutonomyIssue = {
  issueKey: string;
  rootCauseKey: string;
  status: AutonomyIssueStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  severity: AutonomyHealthSeverity;
  actionability: AutonomyHealthActionability;
  labels: string[];
  summaries: string[];
  evidenceRefs: AutonomyHealthEvidenceRef[];
  semanticFingerprint: string;
  semanticRevision: number;
  source: AutonomyHealthSignalSource;
  disposition: {
    kind: AutonomyIssueDispositionKind;
    updatedAt: string;
    semanticRevision: number;
  };
  links: AutonomyIssueLinks;
  history: AutonomyIssueHistoryEntry[];
};

export type AutonomyIssueProjection = {
  schemaVersion: 1;
  updatedAt: string | null;
  issues: AutonomyIssue[];
};

export type AutonomyIssueTransition = {
  issueKey: string;
  rootCauseKey: string;
  kind: AutonomyIssueTransitionKind;
  semanticRevision: number;
  requiresDecision: boolean;
};

export type AutonomyIssueProjectionResult = {
  projection: AutonomyIssueProjection;
  transitions: AutonomyIssueTransition[];
};

export type AutonomyIssueDispositionUpdate = {
  issueKey: string;
  kind: Exclude<AutonomyIssueDispositionKind, "cleared" | "needs-decision">;
  decidedAt: string;
  taskIds: string[];
  ownerQuestionIds: string[];
};
