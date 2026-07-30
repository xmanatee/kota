import { existsSync } from "node:fs";
import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { WorkflowRunStatus } from "#core/workflow/run-types.js";
import {
  type AutomationWorktreeInspection,
  type AutomationWorktreeMetadata,
  inspectAutomationWorktree,
  listAutomationWorktreeUniqueCommits,
} from "#modules/git/worktree-lifecycle.js";
import type {
  WorkflowStateRecoveryRecommendedAction,
  WorkflowStateRecoveryWorktreeEvidence,
} from "#modules/workflow-ops/state-recovery-provider.js";
import { safeTaskClaimSegment } from "./task-claim-types.js";
import type { TaskClaim } from "./task-claims.js";

type OwnerRunStatus = WorkflowRunStatus | "running";

type OwnerRunMetadataProjection = {
  id?: string;
  workflow?: string;
  status?: OwnerRunStatus;
};

const TERMINAL_SUCCESS_STATUSES = new Set<OwnerRunStatus>([
  "success",
  "completed-with-warnings",
]);
const TERMINAL_FAILURE_STATUSES = new Set<OwnerRunStatus>([
  "failed",
  "interrupted",
]);

function isOwnerRunStatus(value: string | undefined): value is OwnerRunStatus {
  return (
    value === "running" ||
    value === "success" ||
    value === "failed" ||
    value === "interrupted" ||
    value === "completed-with-warnings"
  );
}

export function readOwnerRunStatus(
  projectDir: string,
  claim: TaskClaim,
): OwnerRunStatus | null {
  const metadata = readOptionalJsonFile<OwnerRunMetadataProjection>(
    join(projectDir, ".kota", "runs", claim.runId, "metadata.json"),
  );
  if (
    metadata === null ||
    metadata.id !== claim.runId ||
    metadata.workflow !== claim.workflowId ||
    !isOwnerRunStatus(metadata.status)
  ) {
    return null;
  }
  return metadata.status;
}

function metadataPath(projectDir: string, claim: TaskClaim): string {
  return join(
    projectDir,
    ".kota",
    "worktrees",
    `${safeTaskClaimSegment(claim.taskId)}-${safeTaskClaimSegment(claim.worktreeRunId ?? claim.runId)}.json`,
  );
}

function dirtyStateForInspection(
  inspection: AutomationWorktreeInspection,
): WorkflowStateRecoveryWorktreeEvidence["dirtyState"] {
  if (inspection.dirty.conflicted) return "conflicted";
  if (inspection.dirty.dirty) return "dirty";
  return "clean";
}

function mergeStatusForMetadata(metadata: AutomationWorktreeMetadata): string {
  if (metadata.state === "pending-merge") {
    return metadata.stateReason ? `pending-merge: ${metadata.stateReason}` : "pending-merge";
  }
  if (metadata.state === "merged") {
    return metadata.mergedCommit ? `merged: ${metadata.mergedCommit}` : "merged";
  }
  if (metadata.state === "removed") return "removed";
  return "not merged";
}

function worktreeEvidenceFromInspection(
  inspection: AutomationWorktreeInspection,
  projectDir: string,
): WorkflowStateRecoveryWorktreeEvidence {
  const unique = listAutomationWorktreeUniqueCommits(
    projectDir,
    inspection.branch || inspection.headCommit,
  );
  return {
    found: inspection.exists,
    metadataPath: inspection.metadataPath,
    workspaceDir: inspection.metadata.workspaceDir,
    branch: inspection.branch || inspection.metadata.branch,
    state: inspection.metadata.state,
    runState: inspection.runState,
    dirtyState: dirtyStateForInspection(inspection),
    dirtyEntries: inspection.dirty.entries,
    cleanupBlockers: inspection.cleanup.blockers,
    mergeStatus: mergeStatusForMetadata(inspection.metadata),
    headCommit: inspection.headCommit || null,
    uniqueCommits: unique.commits,
    uniqueCommitCount: unique.commits.length,
    ...(unique.error !== undefined ? { uniqueCommitError: unique.error } : {}),
    branchAhead: unique.branchAhead,
    branchBehind: unique.branchBehind,
  };
}

function worktreeEvidenceFromMetadata(
  path: string,
  metadata: AutomationWorktreeMetadata,
  inspectionError?: string,
): WorkflowStateRecoveryWorktreeEvidence {
  const cleanupBlockers = [
    ...(metadata.lastCleanupBlockers ?? []),
    ...(metadata.state === "pending-merge" ? ["worktree is pending merge"] : []),
    ...(inspectionError !== undefined ? [`worktree inspection failed: ${inspectionError}`] : []),
  ];
  return {
    found: existsSync(metadata.workspaceDir),
    metadataPath: path,
    workspaceDir: metadata.workspaceDir,
    branch: metadata.branch,
    state: metadata.state,
    runState: null,
    dirtyState: null,
    dirtyEntries: [],
    cleanupBlockers,
    mergeStatus: mergeStatusForMetadata(metadata),
    headCommit: metadata.mergedCommit ?? null,
    uniqueCommits: [],
    uniqueCommitCount: 0,
    ...(inspectionError !== undefined
      ? { uniqueCommitError: `worktree inspection failed: ${inspectionError}` }
      : {}),
    branchAhead: null,
    branchBehind: null,
  };
}

function missingWorktreeEvidence(path: string): WorkflowStateRecoveryWorktreeEvidence {
  return {
    found: false,
    metadataPath: existsSync(path) ? path : null,
    workspaceDir: null,
    branch: null,
    state: null,
    runState: null,
    dirtyState: null,
    dirtyEntries: [],
    cleanupBlockers: [],
    mergeStatus: null,
    headCommit: null,
    uniqueCommits: [],
    uniqueCommitCount: 0,
    branchAhead: null,
    branchBehind: null,
  };
}

export function readWorktreeEvidence(
  projectDir: string,
  claim: TaskClaim,
): WorkflowStateRecoveryWorktreeEvidence {
  const path = metadataPath(projectDir, claim);
  const metadata = readOptionalJsonFile<AutomationWorktreeMetadata>(path);
  try {
    if (metadata !== null) {
      return worktreeEvidenceFromInspection(
        inspectAutomationWorktree({
          projectDir,
          taskId: claim.taskId,
          runId: claim.worktreeRunId ?? claim.runId,
        }),
        projectDir,
      );
    }
  } catch (error) {
    if (metadata !== null) {
      return worktreeEvidenceFromMetadata(
        path,
        metadata,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  if (metadata !== null) return worktreeEvidenceFromMetadata(path, metadata);
  return missingWorktreeEvidence(path);
}

function hasWorktreeMergeBlocker(worktree: WorkflowStateRecoveryWorktreeEvidence): boolean {
  const text = [
    worktree.state,
    worktree.mergeStatus,
    ...worktree.cleanupBlockers,
  ].join("\n");
  return (
    worktree.uniqueCommitCount > 0 ||
    /\b(conflict|conflicted|pending[- ]merge|unpushed)\b/i.test(text)
  );
}

export function hasPreservedWorktreeChanges(
  worktree: Pick<
    WorkflowStateRecoveryWorktreeEvidence,
    "dirtyState" | "dirtyEntries" | "cleanupBlockers"
  >,
): boolean {
  return (
    worktree.dirtyState === "dirty" ||
    worktree.dirtyState === "conflicted" ||
    worktree.dirtyEntries.length > 0 ||
    worktree.cleanupBlockers.some((blocker) => /\buncommitted\b/i.test(blocker))
  );
}

function hasClaimMergeBlocker(claim: TaskClaim): boolean {
  return /\b(conflict|conflicted|pending[- ]merge|merge gate|manual merge)\b/i.test(
    claim.evidence ?? "",
  );
}

export function recommendedActionFor(
  claim: TaskClaim,
  ownerRunStatus: OwnerRunStatus | null,
  worktree: WorkflowStateRecoveryWorktreeEvidence,
): WorkflowStateRecoveryRecommendedAction {
  const worktreeBlocked = hasWorktreeMergeBlocker(worktree);
  const worktreeDirty = hasPreservedWorktreeChanges(worktree);
  const claimBlocked = hasClaimMergeBlocker(claim);
  if (ownerRunStatus === "running" || worktree.runState === "active") {
    return {
      kind: "active",
      reason: "owning workflow run still appears active",
    };
  }

  if (worktree.state === "merged" || worktree.state === "removed") {
    return {
      kind: "release",
      reason: `worktree metadata is ${worktree.state}`,
    };
  }

  if (worktreeDirty) {
    return {
      kind: "needs-review",
      reason: "worktree contains preserved uncommitted changes that need recovery review",
    };
  }

  if (worktreeBlocked || claimBlocked) {
    return {
      kind: "needs-review",
      reason: "worktree or claim contains unresolved branch integration evidence",
    };
  }

  if (worktree.uniqueCommitError !== undefined) {
    return {
      kind: "needs-review",
      reason: worktree.uniqueCommitError,
    };
  }

  if (TERMINAL_SUCCESS_STATUSES.has(ownerRunStatus as OwnerRunStatus)) {
    return {
      kind: "release",
      reason: "owner run ended successfully and no unresolved merge blocker is visible",
    };
  }

  if (TERMINAL_FAILURE_STATUSES.has(ownerRunStatus as OwnerRunStatus)) {
    return {
      kind: "supersede",
      reason: "owner run ended unsuccessfully and no unresolved merge blocker is visible",
    };
  }

  return {
    kind: "wait",
    reason: "owner run status is unavailable; inspect the run before mutating the claim",
  };
}
