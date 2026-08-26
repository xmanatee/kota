import type {
  WorkflowQueuedRun,
  WorkflowRunMetadata,
} from "#core/workflow/run-types.js";
import type {
  WorkflowBatchFlushPayload,
  WorkflowRunTrigger,
} from "#core/workflow/trigger-types.js";
import type { RepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";
import type {
  ProgressReviewApprovalEvidence,
  ProgressReviewDeadLetterEvidence,
  ProgressReviewEvidenceRef,
  ProgressReviewRunEvidence,
  ProgressReviewScope,
} from "./types.js";

export type ProgressReviewRequestPayload = {
  scopeId?: string;
  reason?: string;
  requestedBy?: string;
  windowMs?: number;
};

export type TaskAttrs = { [key: string]: string | string[] };

export type ProgressReviewDirectorySource = {
  scopeId: string;
  displayName: string;
  /** Repository view used for Git and task evidence. */
  workspaceRoot: string;
  /** Canonical configured scope root. */
  scopeRoot: string;
  /** Canonical durable runtime-state directory. */
  stateDir: string;
  idPrefix: string;
};

export type ProgressReviewConfiguredDirectorySources = {
  sources: ProgressReviewDirectorySource[];
};

export type ProgressReviewEvidenceTarget = {
  scope: ProgressReviewScope;
  sources: ProgressReviewDirectorySource[];
};

export type ScopedRunEvidence = {
  source: ProgressReviewDirectorySource;
  runId: string;
  startedMs: number;
  evidence: ProgressReviewRunEvidence;
};

export type RunArtifactListing = {
  files: string[];
  hitFileLimit: boolean;
  hitDepthLimit: boolean;
  unreadableDirectories: string[];
};

export type ExistingWorkItem = {
  id: string;
  state: RepoTaskState | "inbox";
  path: string;
  scopeId: string;
};

export type ProgressReviewEvidenceScopeRef = {
  scope: ProgressReviewScope;
};

export type ProgressReviewEvidenceIdPacket = {
  scope?: ProgressReviewScope;
  scopes?: readonly ProgressReviewEvidenceScopeRef[];
  evidence: ProgressReviewEvidenceRef[];
};

export type OwnerQuestionFile = {
  id: string;
  status: string;
  question: string;
  reason: string;
  createdAt: string;
  resolvedAt?: string;
};

export type ScopedApprovalEvidence = {
  resolvedOrCreatedMs: number;
  evidence: ProgressReviewApprovalEvidence;
};

export type ScopedDeadLetterEvidence = {
  updatedMs: number;
  evidence: ProgressReviewDeadLetterEvidence;
};

export type ProgressReviewRunMetadataInput = {
  source: ProgressReviewDirectorySource;
  runDirName: string;
  metadata: WorkflowRunMetadata;
};

export type ProgressReviewPendingRunInput = {
  source: ProgressReviewDirectorySource;
  runId: string;
  queued: WorkflowQueuedRun;
};

export type ProgressReviewBatchPayload = WorkflowBatchFlushPayload;
export type ProgressReviewWorkflowTrigger = WorkflowRunTrigger;
