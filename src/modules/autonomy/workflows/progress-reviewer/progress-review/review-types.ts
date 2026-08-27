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
  topicKey: string;
  title: string;
  problem: string;
  priority: "p0" | "p1" | "p2" | "p3";
  evidenceIds: string[];
  howWeWillKnow: string;
};

export type ProgressReviewFindingGroup = {
  claims: ProgressReviewClaimOutput[];
  followUpTasks: ProgressReviewFollowUpTaskOutput[];
};

export type ProgressReviewOwnerQuestionOutput = {
  topicKey: string;
  question: string;
  reason: string;
  evidenceIds: string[];
  proposedAnswers?: string[];
};

export type ProgressReviewResolutionOutput = {
  topicKey: string;
  reason: string;
  evidenceIds: string[];
};

export type ProgressReviewAgentOutput = {
  verdict: "on-track" | "needs-steering" | "blocked" | "insufficient-evidence";
  summary: string;
  findings: {
    crossScope: ProgressReviewFindingGroup;
    localScope: ProgressReviewFindingGroup;
  };
  ownerQuestions: ProgressReviewOwnerQuestionOutput[];
  resolutions?: ProgressReviewResolutionOutput[];
};

export type ProgressReviewAppliedAction =
  | {
      kind: "created-task";
      taskId: string;
      path: string;
      title: string;
    }
  | {
      kind: "updated-task";
      taskId: string;
      path: string;
      title: string;
    }
  | {
      kind: "dropped-task";
      taskId: string;
      fromState: RepoTaskState;
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
      kind: "updated-owner-question";
      questionId: string;
      question: string;
    }
  | {
      kind: "owner-question-pending";
      question: string;
    }
  | {
      kind: "skipped-owner-question";
      question: string;
      reason: string;
    }
  | {
      kind: "dismissed-owner-question";
      questionId: string;
    }
  | {
      kind: "owner-question-dismissal-pending";
      topicKey: string;
      reason: string;
    }
  | {
      kind: "resolved-work";
      topicKey: string;
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
