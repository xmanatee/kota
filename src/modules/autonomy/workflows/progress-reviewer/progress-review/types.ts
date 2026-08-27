import type { ApprovalStatus, PendingApproval } from "#core/daemon/approval-queue.js";
import type {
  DeadLetterItemType,
  DeadLetterQueueCounts,
} from "#core/daemon/dead-letter-queue.js";
import type {
  EvidenceArtifactType,
  EvidenceJsonObject,
  EvidenceProvenance,
} from "#core/evidence/policy.js";
import type { EvidencePrunedReasonCode } from "#core/evidence/pruned-reference.js";
import type {
  RepoTaskPriority,
  RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";

export type ProgressReviewTriggerKind =
  | "manual"
  | "semantic-boundary"
  | "schedule"
  | "run-count"
  | "task-count"
  | "message-batch"
  | "event-batch";

export type ProgressReviewScope = {
  kind: "global" | "directory";
  scopeId: string;
  displayName: string;
  directoryRoot?: string;
};

export type ProgressReviewPrunedEvidenceReference = {
  reasonCode: EvidencePrunedReasonCode;
  artifactType: EvidenceArtifactType;
  id: string;
  prunedAt: string;
  retained: EvidenceJsonObject;
  provenance: EvidenceProvenance;
};

export type ProgressReviewEvidenceRef = {
  id: string;
  kind:
    | "run"
    | "task"
    | "event"
    | "artifact"
    | "git"
    | "owner-question"
    | "approval"
    | "dead-letter"
    | "state";
  summary: string;
  path?: string;
  pruned?: ProgressReviewPrunedEvidenceReference;
};

export type ProgressReviewRunEvidence = ProgressReviewEvidenceRef & {
  kind: "run";
  workflow: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  triggerEvent?: string;
};

export type ProgressReviewTaskEvidence = ProgressReviewEvidenceRef & {
  kind: "task";
  taskId: string;
  title: string;
  state: RepoTaskState;
  priority: RepoTaskPriority | null;
  dependsOn: string[];
  waitingOn: string[];
  operatorEvidenceMentioned: boolean;
};

export type ProgressReviewEventEvidence = ProgressReviewEvidenceRef & {
  kind: "event";
  event: string;
  receivedAt: string;
  source: "batch" | "journal";
  journalId?: string;
  sourceId?: string;
  payloadSummary?: string;
};

export type ProgressReviewArtifactEvidence = ProgressReviewEvidenceRef & {
  kind: "artifact";
  runId: string;
  file: string;
};

export type ProgressReviewGitEvidence =
  | (ProgressReviewEvidenceRef & {
      kind: "git";
      gitKind: "worktree-status";
      statusLine: string;
    })
  | (ProgressReviewEvidenceRef & {
      kind: "git";
      gitKind: "commit";
      commit: string;
      committedAt: string;
    })
  | (ProgressReviewEvidenceRef & {
      kind: "git";
      gitKind: "commit-file";
      commit: string;
      committedAt: string;
      change: string;
      file: string;
    });

export type ProgressReviewOwnerQuestionEvidence = ProgressReviewEvidenceRef & {
  kind: "owner-question";
  questionId: string;
  status: string;
  createdAt: string;
  resolvedAt?: string;
};

export type ProgressReviewApprovalEvidence = ProgressReviewEvidenceRef & {
  kind: "approval";
  approvalId: string;
  status: ApprovalStatus;
  tool: string;
  risk: PendingApproval["risk"];
  reason: string;
  createdAt: string;
  resolvedAt?: string;
  resolutionSource?: string;
};

export type ProgressReviewDeadLetterEvidence = ProgressReviewEvidenceRef & {
  kind: "dead-letter";
  itemId: string;
  itemType: DeadLetterItemType;
  status: "open";
  failureClass: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
  affectedWorkflowNames: string[];
  sourceEventIds: string[];
  redriveAttemptCount: number;
};

export type ProgressReviewDeadLetterCounts = DeadLetterQueueCounts & {
  scopeId: string;
  path: string;
  openItemIds: string[];
  redriveRunIds: string[];
};

export type ProgressReviewEvidenceWindow = {
  startedAt: string;
  endedAt: string;
  maxAgeMs: number;
};

export type ProgressReviewScopeEvidence = {
  scope: ProgressReviewScope;
  window: ProgressReviewEvidenceWindow;
  runs: ProgressReviewRunEvidence[];
  tasks: ProgressReviewTaskEvidence[];
  events: ProgressReviewEventEvidence[];
  artifacts: ProgressReviewArtifactEvidence[];
  git: ProgressReviewGitEvidence[];
  ownerQuestions: ProgressReviewOwnerQuestionEvidence[];
  approvals: ProgressReviewApprovalEvidence[];
  deadLetterCounts: ProgressReviewDeadLetterCounts[];
  deadLetters: ProgressReviewDeadLetterEvidence[];
  canonicalState: ProgressReviewEvidenceRef[];
  evidence: ProgressReviewEvidenceRef[];
  excluded: string[];
};

export type ProgressReviewEvidencePacket = {
  generatedAt: string;
  semanticInput: {
    automatic: boolean;
    boundary: string;
    inputRevision: number | null;
    evidenceRefs: string[];
    reason: string;
  };
  triggerKind: ProgressReviewTriggerKind;
  triggerEvent: string;
  scope: ProgressReviewScope;
  window: ProgressReviewEvidenceWindow;
  batch: {
    sourceEventName: string;
    reason: string;
    count: number;
    inputEventCount: number;
    groupingKey: string;
    droppedInputCount: number;
    journalBackfillCount: number;
  } | null;
  scopes: ProgressReviewScopeEvidence[];
  runs: ProgressReviewRunEvidence[];
  tasks: ProgressReviewTaskEvidence[];
  events: ProgressReviewEventEvidence[];
  artifacts: ProgressReviewArtifactEvidence[];
  git: ProgressReviewGitEvidence[];
  ownerQuestions: ProgressReviewOwnerQuestionEvidence[];
  approvals: ProgressReviewApprovalEvidence[];
  deadLetterCounts: ProgressReviewDeadLetterCounts[];
  deadLetters: ProgressReviewDeadLetterEvidence[];
  canonicalState: ProgressReviewEvidenceRef[];
  evidence: ProgressReviewEvidenceRef[];
  excluded: string[];
};

export type {
  ProgressReviewAgentEvidencePacket,
  ProgressReviewAgentScopeSummary,
  ProgressReviewEvidenceCounts,
} from "./agent-packet-types.js";

export type {
  ExistingWorkItem,
  OwnerQuestionFile,
  ProgressReviewBatchPayload,
  ProgressReviewConfiguredDirectorySources,
  ProgressReviewDirectorySource,
  ProgressReviewEvidenceIdPacket,
  ProgressReviewEvidenceScopeRef,
  ProgressReviewEvidenceTarget,
  ProgressReviewPendingRunInput,
  ProgressReviewRequestPayload,
  ProgressReviewRunMetadataInput,
  ProgressReviewWorkflowTrigger,
  RunArtifactListing,
  ScopedApprovalEvidence,
  ScopedDeadLetterEvidence,
  ScopedRunEvidence,
  TaskAttrs,
} from "./internal-types.js";
export type {
  ProgressReviewActionResult,
  ProgressReviewAgentOutput,
  ProgressReviewAppliedAction,
  ProgressReviewArtifact,
  ProgressReviewClaimOutput,
  ProgressReviewFindingGroup,
  ProgressReviewFollowUpTaskOutput,
  ProgressReviewOwnerQuestionOutput,
  ProgressReviewResolutionOutput,
} from "./review-types.js";
