import type { OwnerQuestionEnqueueInput } from "#core/daemon/owner-question-queue.js";
import type { RepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";

export type GeneratedWorkProvenance = {
  source: string;
  runId: string;
  issueKey?: string;
  semanticRevision?: number;
  evidenceRefs: string[];
};

export type GeneratedWorkTaskProposal = {
  kind: "task";
  proposalKey: string;
  title: string;
  priority: "p0" | "p1" | "p2" | "p3";
  body: string;
  provenance: GeneratedWorkProvenance;
};

export type GeneratedWorkQuestionProposal = {
  kind: "owner-question";
  proposalKey: string;
  question: string;
  reason: string;
  context: string;
  proposedAnswers: string[];
  provenance: GeneratedWorkProvenance;
  origin: OwnerQuestionEnqueueInput["origin"];
};

export type GeneratedWorkResolution = {
  kind: "none";
  proposalKey: string;
  reason: string;
  source: string;
};

export type GeneratedWorkProposal =
  | GeneratedWorkTaskProposal
  | GeneratedWorkQuestionProposal
  | GeneratedWorkResolution;

export type GeneratedWorkProposalAction =
  | { kind: "created-task"; taskId: string; path: string }
  | { kind: "updated-task"; taskId: string; path: string }
  | { kind: "reopened-task"; taskId: string; path: string; fromState: RepoTaskState }
  | { kind: "dropped-task"; taskId: string; fromState: RepoTaskState }
  | { kind: "created-owner-question"; questionId: string }
  | { kind: "updated-owner-question"; questionId: string }
  | { kind: "reopened-owner-question"; questionId: string }
  | { kind: "dismissed-owner-question"; questionId: string }
  | { kind: "noop"; reason: string };

export type GeneratedWorkProposalResult = {
  proposalKey: string;
  taskId: string | null;
  ownerQuestionId: string | null;
  actions: GeneratedWorkProposalAction[];
  touchedTaskQueue: boolean;
};
