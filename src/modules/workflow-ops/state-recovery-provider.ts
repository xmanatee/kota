import { defineProviderToken } from "#core/modules/provider-registry.js";
import type { ScopeSelector } from "#core/server/scope-selector.js";

export type WorkflowStateRecoveryAction = "release" | "supersede";

export type WorkflowStateRecoveryRecommendedAction =
  | { kind: "release"; reason: string }
  | { kind: "supersede"; reason: string }
  | { kind: "blocked"; reason: string }
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
  state: string | null;
  runState: string | null;
  dirtyState: string | null;
  dirtyEntries: string[];
  cleanupBlockers: string[];
  mergeStatus: string | null;
  headCommit: string | null;
};

export type WorkflowStateRecoveryDeadLetterLink = {
  id: string;
  status: string;
  type: string;
  affectedWorkflowNames: string[];
  reason: string;
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

export type WorkflowStateRecoveryListInput = ScopeSelector & {
  projectDir: string;
};

export type WorkflowStateRecoveryListResult =
  | {
      ok: true;
      claims: WorkflowStateRecoveryClaim[];
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

export const WORKFLOW_STATE_RECOVERY_PROVIDER_TYPE =
  defineProviderToken<WorkflowStateRecoveryProvider>("workflow-state-recovery");
