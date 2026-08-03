import { join } from "node:path";
import type { RepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";

export const DEFAULT_TASK_CLAIM_LEASE_MS = 7 * 60 * 60 * 1000;
export const CLAIM_SCHEMA_VERSION = 1;
export const CLAIMS_ROOT = join(".kota", "task-claims");
export const ACTIVE_CLAIMS_DIR = join(CLAIMS_ROOT, "active");
export const CLAIM_HISTORY_DIR = join(CLAIMS_ROOT, "history");
export const CLAIM_CANDIDATE_STATES: readonly RepoTaskState[] = ["doing", "ready"];

export type TaskClaimStatus =
  | "active"
  | "pending-decomposition"
  | "pending-merge"
  | "released"
  | "expired"
  | "superseded";

export type TaskClaimRecoveryStatus =
  | "agent-running"
  | "pending-decomposition"
  | "pending-merge"
  | "stale"
  | "expired"
  | "released"
  | "superseded";

export type TaskClaimRecoveryPath =
  | "new-claim"
  | "continued-preserved-claim"
  | "resumed-active-claim"
  | "resumed-stale-claim"
  | "replaced-stale-claim"
  | "replaced-expired-claim"
  | "replaced-superseded-claim"
  | "skipped-active-claim"
  | "skipped-pending-decomposition"
  | "skipped-stale-worktree"
  | "skipped-pending-merge"
  | "write-conflict"
  | "no-actionable-task";

export function skippedTaskClaimRecoveryPath(
  recoveryStatus: TaskClaimRecoveryStatus,
): TaskClaimRecoveryPath {
  switch (recoveryStatus) {
    case "pending-decomposition":
      return "skipped-pending-decomposition";
    case "pending-merge":
      return "skipped-pending-merge";
    case "stale":
      return "skipped-stale-worktree";
    default:
      return "skipped-active-claim";
  }
}

export type TaskClaim = {
  schemaVersion: typeof CLAIM_SCHEMA_VERSION;
  taskId: string;
  taskState: RepoTaskState;
  runId: string;
  /** Original builder run that owns the preserved worktree, when this claim is continued. */
  worktreeRunId?: string;
  workflowId: string;
  owner: string;
  workspaceDir: string;
  branch: string;
  baseCommit: string;
  leaseMs: number;
  leaseAcquiredAt: string;
  leaseExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  status: TaskClaimStatus;
  evidence: string | null;
};

export type TaskClaimInspection = {
  claim: TaskClaim;
  path: string;
  recoveryStatus: TaskClaimRecoveryStatus;
  safeToRetry: boolean;
};

export type ClaimTaskInput = {
  projectDir: string;
  taskId: string;
  taskState: RepoTaskState;
  runId: string;
  workflowId: string;
  owner: string;
  workspaceDir: string;
  branch: string;
  baseCommit: string;
  leaseMs?: number;
  now?: Date;
};

export type ClaimTaskAttempt = {
  claimed: boolean;
  taskId: string;
  claim: TaskClaim | null;
  recoveryStatus: TaskClaimRecoveryStatus | null;
  safeToRetry: boolean;
  recoveryPath: TaskClaimRecoveryPath;
  reason: string | null;
};

export type ClaimNextQueueTaskInput = Omit<ClaimTaskInput, "taskId" | "taskState"> & {
  candidateStates?: readonly RepoTaskState[];
};

export type QueueTaskClaimResult = {
  claimed: boolean;
  taskId: string | null;
  claim: TaskClaim | null;
  recoveryStatus: TaskClaimRecoveryStatus | null;
  safeToRetry: boolean;
  recoveryPath: TaskClaimRecoveryPath;
  reason: string | null;
  candidateCount: number;
  skipped: ClaimTaskAttempt[];
  activeClaims: TaskClaimInspection[];
};

export type TaskClaimTerminalResult = {
  taskId: string;
  changed: boolean;
  claim: TaskClaim | null;
  recoveryStatus: TaskClaimRecoveryStatus;
  safeToRetry: boolean;
  reason: string | null;
};

export type TaskClaimMutationInput = {
  projectDir: string;
  taskId: string;
  runId: string;
  workflowId: string;
  evidence: string;
  now?: Date;
  leaseMs?: number;
};

export type TaskClaimWorkspaceInput = TaskClaimMutationInput & {
  workspaceDir: string;
  branch: string;
  baseCommit: string;
};

export type ContinueTaskClaimInput = {
  projectDir: string;
  taskId: string;
  sourceRunId: string;
  runId: string;
  workflowId: string;
  owner: string;
  evidence: string;
  leaseMs?: number;
  now?: Date;
};

export function safeTaskClaimSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}
