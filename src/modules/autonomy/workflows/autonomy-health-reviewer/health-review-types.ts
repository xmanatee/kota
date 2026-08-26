import type { AutonomyIssueTransition } from "#modules/autonomy/autonomy-issue-projection.js";
import type {
  AutonomyHealthActionability,
  AutonomyHealthEvidenceRef,
  AutonomyHealthObservation,
  AutonomyHealthSeverity,
  AutonomyHealthSignal,
} from "#modules/autonomy/health-signal.js";

export type AutonomyHealthReviewGroup = {
  dedupeKey: string;
  observation: AutonomyHealthObservation;
  labels: string[];
  labelsKey: string;
  source: AutonomyHealthSignal["source"];
  severity: AutonomyHealthSeverity;
  actionability: AutonomyHealthActionability;
  signalCount: number;
  observationCount: number;
  signalIds: string[];
  summaries: string[];
  evidenceRefs: AutonomyHealthEvidenceRef[];
  evidenceFingerprint: string;
};

export type AutonomyHealthReview = {
  generatedAt: string;
  trigger: {
    kind: "batch" | "signal";
    sourceEventName: string;
    count: number;
    groupingKey?: string;
    reason?: string;
    scopeId?: string;
  };
  scope: {
    scopeId?: string;
  };
  signals: AutonomyHealthSignal[];
  groups: AutonomyHealthReviewGroup[];
  counts: {
    bySeverity: Record<string, number>;
    byActionability: Record<string, number>;
    byLabel: Record<string, number>;
  };
};

export type AutonomyHealthAppliedAction =
  | {
      kind: "decision-requested";
      issueKey: string;
      dedupeKey: string;
      semanticRevision: number;
      transition: AutonomyIssueTransition["kind"];
    }
  | {
      kind: "resolved";
      issueKey: string;
      dedupeKey: string;
      semanticRevision: number;
      transition: "cleared";
    };

export type AutonomyHealthReviewActionResult = {
  createdTaskIds: string[];
  droppedTaskIds: string[];
  ownerQuestionIds: string[];
  dismissedOwnerQuestionIds: string[];
  taskMutationPaths: string[];
  issueTransitions: AutonomyIssueTransition[];
  applied: AutonomyHealthAppliedAction[];
  touchedTaskQueue: boolean;
};

export type AutonomyHealthReviewArtifact = {
  generatedAt: string;
  review: AutonomyHealthReview;
  actions: AutonomyHealthReviewActionResult;
};
