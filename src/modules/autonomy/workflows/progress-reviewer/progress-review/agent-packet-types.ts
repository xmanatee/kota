import type {
  ProgressReviewDeadLetterCounts,
  ProgressReviewEvidencePacket,
  ProgressReviewEvidenceRef,
  ProgressReviewOperatorJourneyRisk,
  ProgressReviewScope,
  ProgressReviewTaskClassCount,
  ProgressReviewTriggerKind,
} from "./types.js";

export type ProgressReviewEvidenceCounts = {
  runs: number;
  tasks: number;
  events: number;
  artifacts: number;
  git: number;
  ownerQuestions: number;
  approvals: number;
  deadLetters: number;
  state: number;
  evidence: number;
  taskClasses: ProgressReviewTaskClassCount[];
};

export type ProgressReviewAgentScopeSummary = {
  scope: ProgressReviewScope;
  window: ProgressReviewEvidencePacket["window"];
  counts: ProgressReviewEvidenceCounts;
  excluded: string[];
};

export type ProgressReviewAgentEvidencePacket = {
  generatedAt: string;
  semanticInput: ProgressReviewEvidencePacket["semanticInput"];
  triggerKind: ProgressReviewTriggerKind;
  triggerEvent: string;
  scope: ProgressReviewScope;
  window: ProgressReviewEvidencePacket["window"];
  batch: ProgressReviewEvidencePacket["batch"];
  scopes: ProgressReviewAgentScopeSummary[];
  counts: ProgressReviewEvidenceCounts;
  deadLetterCounts: ProgressReviewDeadLetterCounts[];
  operatorJourneyRisks: ProgressReviewOperatorJourneyRisk[];
  evidence: ProgressReviewEvidenceRef[];
  excluded: string[];
};
