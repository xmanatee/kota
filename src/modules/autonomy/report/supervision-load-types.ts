import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { ReviewScrutinyReport } from "#modules/autonomy/review-scrutiny.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { ReportPriority } from "./aggregate-types.js";
import type { PostCompletionFollowUpReport } from "./post-completion-followups.js";

export type SupervisionLoadStatus =
  | "normal"
  | "busy"
  | "overloaded"
  | "unknown";

export type SupervisionLoadEvidenceSource =
  | "active-runs"
  | "approvals"
  | "owner-questions"
  | "dead-letters"
  | "attention-items";

export type SupervisionLoadEvidenceStatus =
  | "available"
  | "missing"
  | "unreadable";

export type SupervisionLoadEvidence = {
  source: SupervisionLoadEvidenceSource;
  status: SupervisionLoadEvidenceStatus;
  path: string;
  message: string;
};

export type SupervisionLoadCounts = {
  activeRuns: number | null;
  pendingApprovals: number | null;
  pendingOwnerQuestions: number | null;
  openDeadLetters: number | null;
  attentionItems: number | null;
  postCompletionFollowUps: number;
  reviewEvidenceGaps: number;
};

export type SupervisionLoadWeights = {
  [K in keyof SupervisionLoadCounts]: number;
};

export type SupervisionLoadThresholds = {
  busyAt: number;
  overloadedAt: number;
  weights: SupervisionLoadWeights;
};

export type SupervisionLoadScore = {
  status: SupervisionLoadStatus;
  score: number | null;
  knownScore: number;
  unknownEvidenceCount: number;
};

export type SupervisionLoadWorkstreamGroup = {
  workflow: string;
  priority: ReportPriority;
  scopeId: string | null;
  activeRuns: number;
};

export type SupervisionLoadReferenceKind =
  | "active-run"
  | "approval"
  | "owner-question"
  | "dead-letter"
  | "attention-item"
  | "post-completion-follow-up";

export type SupervisionLoadReference = {
  kind: SupervisionLoadReferenceKind;
  id: string;
  reason: string;
  workflow: string | null;
  taskId: string | null;
  taskTitle: string | null;
  scopeId: string | null;
};

export type SupervisionLoadReport = {
  generatedAt: string;
  status: SupervisionLoadStatus;
  counts: SupervisionLoadCounts;
  score: SupervisionLoadScore;
  thresholds: SupervisionLoadThresholds;
  evidence: SupervisionLoadEvidence[];
  workstreams: SupervisionLoadWorkstreamGroup[];
  topReferences: SupervisionLoadReference[];
};

export type BuildSupervisionLoadReportInput = {
  workspaceRoot: string;
  stateDir: string;
  runsDir: string;
  runs: readonly WorkflowRunMetadata[];
  tasks: readonly RepoTaskFullRecord[];
  windowEndMs: number;
  reviewScrutiny: ReviewScrutinyReport;
  postCompletionFollowUps: PostCompletionFollowUpReport;
};

export type StoreResult<TItem> = {
  items: TItem[] | null;
  evidence: SupervisionLoadEvidence;
};

export type ApprovalRecord = {
  id: string;
  status: string;
  tool: string;
  risk: string;
};

export type OwnerQuestionRecord = {
  id: string;
  status: string;
  workflow: string | null;
  runId: string | null;
  taskId: string | null;
};

export type DeadLetterRecord = {
  id: string;
  status: string;
  type: string;
  workflows: string[];
  scopeId: string | null;
  failedRunId: string | null;
};

export type AttentionRecord = {
  id: string;
  label: string;
  detail: string;
};

export type SupervisionLoadStoreReads = {
  activeRuns: StoreResult<WorkflowRunMetadata>;
  approvals: StoreResult<ApprovalRecord>;
  ownerQuestions: StoreResult<OwnerQuestionRecord>;
  deadLetters: StoreResult<DeadLetterRecord>;
  attentionItems: StoreResult<AttentionRecord>;
};

export const DEFAULT_SUPERVISION_LOAD_THRESHOLDS: SupervisionLoadThresholds = {
  busyAt: 3,
  overloadedAt: 6,
  weights: {
    activeRuns: 1,
    pendingApprovals: 2,
    pendingOwnerQuestions: 2,
    openDeadLetters: 2,
    attentionItems: 1,
    postCompletionFollowUps: 1,
    reviewEvidenceGaps: 1,
  },
};

export const TOP_REFERENCE_LIMIT = 12;
