import type { RepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";
import type {
  ProgressReviewAgentEvidencePacket,
  ProgressReviewEvidencePacket,
} from "./types.js";

export type ProgressReviewClaimOutput = {
  id: string;
  claim: string;
  evidenceIds: string[];
  confidence: "low" | "medium" | "high";
};

export type ProgressReviewFollowUpTaskOutput = {
  title: string;
  summary: string;
  priority: "p0" | "p1" | "p2" | "p3";
  area: string;
  evidenceIds: string[];
  acceptanceEvidence: string;
};

export type ProgressReviewFindingGroup = {
  claims: ProgressReviewClaimOutput[];
  followUpTasks: ProgressReviewFollowUpTaskOutput[];
};

export type ProgressReviewOwnerQuestionOutput = {
  question: string;
  reason: string;
  evidenceIds: string[];
  proposedAnswers?: string[];
};

export type ProgressReviewAgentOutput = {
  verdict: "on-track" | "needs-steering" | "blocked" | "insufficient-evidence";
  summary: string;
  findings: {
    crossScope: ProgressReviewFindingGroup;
    localScope: ProgressReviewFindingGroup;
  };
  ownerQuestions: ProgressReviewOwnerQuestionOutput[];
};

export type ProgressReviewAppliedAction =
  | {
      kind: "created-task";
      taskId: string;
      path: string;
      title: string;
    }
  | {
      kind: "skipped-task";
      title: string;
      reason: string;
      existingTaskId?: string;
      existingState?: RepoTaskState | "inbox";
      existingPath?: string;
      existingScopeId?: string;
    }
  | {
      kind: "owner-question";
      questionId: string;
      question: string;
    }
  | {
      kind: "skipped-owner-question";
      question: string;
      reason: string;
    };

export type ProgressReviewActionResult = {
  createdTaskIds: string[];
  ownerQuestionIds: string[];
  applied: ProgressReviewAppliedAction[];
  touchedTaskQueue: boolean;
};

export type ProgressReviewArtifact = {
  generatedAt: string;
  evidence: ProgressReviewEvidencePacket;
  reviewInput: ProgressReviewAgentEvidencePacket;
  review: ProgressReviewAgentOutput;
  actions: ProgressReviewActionResult;
};
