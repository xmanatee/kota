import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type {
  RepoTaskFullRecord,
  RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";

export const POST_COMPLETION_FOLLOW_UP_REASONS = [
  "regression",
  "ci-build-failure",
  "security",
  "review-scrutiny",
  "trajectory-diagnostic",
  "workflow-failure",
  "missing-evidence",
  "operator-report",
] as const;

export type PostCompletionCorrectiveReason =
  (typeof POST_COMPLETION_FOLLOW_UP_REASONS)[number];

export type PostCompletionFollowUpReasonCount = {
  reason: PostCompletionCorrectiveReason;
  count: number;
};

export type PostCompletionCorrectiveLink = {
  completedTaskId: string;
  completedTaskTitle: string;
  activeFollowUpTaskId: string;
  activeFollowUpTitle: string;
  activeFollowUpState: RepoTaskState;
  reasons: PostCompletionCorrectiveReason[];
  matchedRefs: string[];
  sourceRunIds: string[];
  sourceCommitRefs: string[];
  sourceArtifactPaths: string[];
};

export type PostCompletionFollowUpReport = {
  totalCorrectiveFollowUps: number;
  linkedCompletedTaskCount: number;
  byReason: PostCompletionFollowUpReasonCount[];
  completedTaskIds: string[];
  activeFollowUpTaskIds: string[];
  links: PostCompletionCorrectiveLink[];
  truncatedLinkCount: number;
};

export type BuildPostCompletionFollowUpReportInput = {
  tasks: readonly RepoTaskFullRecord[];
  runs: readonly WorkflowRunMetadata[];
  runsDir: string;
  windowStartMs: number;
  windowEndMs: number;
};

export type BuilderEvidence = {
  runId: string;
  commitSha: string;
  completedAtMs: number;
};

export type EvidenceRefs = {
  taskIds: Set<string>;
  runIds: Set<string>;
  commitRefs: Set<string>;
  artifactPaths: Set<string>;
};
