import { defineProviderToken } from "#core/modules/provider-registry.js";
import type { ScopeSelector } from "#core/server/scope-selector.js";
import { validateWorkflowRunId } from "#core/workflow/run-io.js";

export type WorkflowStateRecoveryAction = "release" | "supersede";

export type WorkflowStateRecoveryRecommendedAction =
  | { kind: "active"; reason: string }
  | { kind: "release"; reason: string }
  | { kind: "supersede"; reason: string }
  | { kind: "cleanup"; reason: string }
  | { kind: "dismiss-dlq"; reason: string }
  | { kind: "needs-review"; reason: string }
  | { kind: "wait"; reason: string };

export type WorkflowStateRecoveryClaimSnapshot = {
  taskId: string;
  taskState: string;
  runId: string;
  workflowId: string;
  owner: string;
  workspaceDir: string;
  branch: string;
  baseCommit: string;
  status: string;
  evidence: string | null;
  updatedAt: string;
};

export type WorkflowStateRecoveryWorktreeEvidence = {
  found: boolean;
  metadataPath: string | null;
  workspaceDir: string | null;
  branch: string | null;
  state: string | null;
  runState: string | null;
  dirtyState: string | null;
  dirtyEntries: string[];
  cleanupBlockers: string[];
  mergeStatus: string | null;
  headCommit: string | null;
  uniqueCommits: string[];
  uniqueCommitCount: number;
  uniqueCommitError?: string;
  branchAhead: number | null;
  branchBehind: number | null;
};

export type WorkflowStateRecoveryDeadLetterLink = {
  id: string;
  status: string;
  type: string;
  failureClass?: string;
  sourceKind?: string;
  workflowName?: string;
  affectedWorkflowNames: string[];
  reason: string;
  duplicateFingerprint?: string;
  duplicateCount?: number;
  duplicateOf?: string;
  recommendedAction?: WorkflowStateRecoveryRecommendedAction;
  dismissCommand: string;
  redriveCommand: string;
};

export type WorkflowStateRecoveryClaim = {
  claim: WorkflowStateRecoveryClaimSnapshot;
  claimPath: string;
  recoveryStatus: string;
  safeToRetry: boolean;
  ownerRunStatus: string | null;
  worktree: WorkflowStateRecoveryWorktreeEvidence;
  relatedDeadLetters: WorkflowStateRecoveryDeadLetterLink[];
  recommendedAction: WorkflowStateRecoveryRecommendedAction;
};

export type WorkflowStateRecoveryWorktree = {
  taskId: string;
  runId: string;
  workflowId: string;
  owner: string;
  metadataPath: string;
  workspaceDir: string;
  branch: string;
  state: string;
  metadataState: string;
  runState: string;
  dirtyState: string;
  dirtyEntries: string[];
  cleanupBlockers: string[];
  mergeStatus: string;
  headCommit: string;
  uniqueCommits: string[];
  uniqueCommitCount: number;
  uniqueCommitError?: string;
  branchAhead: number | null;
  branchBehind: number | null;
  relatedDeadLetters: WorkflowStateRecoveryDeadLetterLink[];
  recommendedAction: WorkflowStateRecoveryRecommendedAction;
};

export type WorkflowStateRecoveryListInput = ScopeSelector & {
  projectDir: string;
};

export type WorkflowStateRecoveryListResult =
  | {
      ok: true;
      claims: WorkflowStateRecoveryClaim[];
      worktrees: WorkflowStateRecoveryWorktree[];
      deadLetters: WorkflowStateRecoveryDeadLetterLink[];
    }
  | {
      ok: false;
      reason: "provider_unavailable";
      message: string;
    };

export type WorkflowStateRecoveryResolveInput = ScopeSelector & {
  projectDir: string;
  taskId: string;
  action: WorkflowStateRecoveryAction;
  rationale: string;
  runId?: string;
  actor?: string;
  artifactRunId?: string;
  supersededByCommit?: string;
  cleanupWorktree?: boolean;
  discardWorktreeChanges?: boolean;
  dismissDeadLetters?: boolean;
  completeTask?: boolean;
};

export type WorkflowStateRecoveryArtifact = {
  schemaVersion: 1;
  createdAt: string;
  projectDir: string;
  actor: string;
  taskId: string;
  requestedRunId: string | null;
  action: WorkflowStateRecoveryAction;
  rationale: string;
  before: WorkflowStateRecoveryClaim | null;
  after: WorkflowStateRecoveryClaim | null;
  relatedDeadLetters: WorkflowStateRecoveryDeadLetterLink[];
  dismissedDeadLetterIds?: string[];
  worktreeCleanup?: {
    attempted: boolean;
    removed: boolean;
    message: string;
    blockers: string[];
  };
  taskMove?: {
    attempted: boolean;
    moved: boolean;
    message: string;
    fromState?: string;
    toState?: string;
    path?: string;
  };
  result: "released" | "superseded" | "noop" | "refused";
  message: string;
};

export type WorkflowStateRecoveryResolveResult =
  | {
      ok: true;
      action: WorkflowStateRecoveryAction | "noop";
      message: string;
      artifactPath: string;
      artifact: WorkflowStateRecoveryArtifact;
    }
  | {
      ok: false;
      reason:
        | "provider_unavailable"
        | "not_found"
        | "invalid_input"
        | "invalid_action"
        | "unsafe"
        | "write_conflict";
      message: string;
      artifactPath?: string;
      artifact?: WorkflowStateRecoveryArtifact;
    };

export type WorkflowStateRecoveryProvider = {
  list(input: WorkflowStateRecoveryListInput): WorkflowStateRecoveryListResult;
  resolve(input: WorkflowStateRecoveryResolveInput): WorkflowStateRecoveryResolveResult;
};

export function validateWorkflowStateRecoveryArtifactRunId(
  artifactRunId: string | undefined,
): { ok: true; artifactRunId?: string } | { ok: false; message: string } {
  if (artifactRunId === undefined) return { ok: true };
  try {
    return {
      ok: true,
      artifactRunId: validateWorkflowRunId(
        artifactRunId,
        "Workflow state recovery artifactRunId",
      ),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export const WORKFLOW_STATE_RECOVERY_PROVIDER_TYPE =
  defineProviderToken<WorkflowStateRecoveryProvider>("workflow-state-recovery");
