import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { WorkflowStateRecoveryClaim } from "#modules/workflow-ops/state-recovery-provider.js";

export type BuilderRecoveryRequest = {
  taskId: string;
  sourceRunId: string;
  worktreeRunId: string;
  workspaceDir: string;
  idempotencyKey: string;
  reason: string;
};

type BuilderTerminalContinuation = {
  recoveryRequested?: boolean;
  continuationDecision?: string | null;
};

function readTerminalContinuation(
  projectDir: string,
  candidate: WorkflowStateRecoveryClaim,
): BuilderTerminalContinuation | null {
  return readOptionalJsonFile<BuilderTerminalContinuation>(
    join(
      projectDir,
      ".kota",
      "runs",
      candidate.claim.runId,
      "terminal-worktree-finalizer.json",
    ),
  );
}

function isCommittedPendingMerge(
  candidate: WorkflowStateRecoveryClaim,
): boolean {
  return (
    candidate.claim.status === "pending-merge" &&
    candidate.worktree.state === "pending-merge" &&
    candidate.worktree.dirtyState === "clean" &&
    candidate.worktree.uniqueCommitCount > 0
  );
}

function isRetryableCommittedPendingMerge(
  candidate: WorkflowStateRecoveryClaim,
): boolean {
  if (!isCommittedPendingMerge(candidate)) return false;
  const reconciliation = candidate.worktree.canonicalReconciliation;
  return (
    reconciliation === undefined ||
    (reconciliation.conflicts.length === 0 &&
      reconciliation.canonicalDestructivePaths.length === 0)
  );
}

export function preservedBuilderWorkspaceDir(
  projectDir: string,
  candidate: WorkflowStateRecoveryClaim,
): string | null {
  const recoverableOwnerRun =
    candidate.claim.status === "pending-merge" ||
    candidate.ownerRunStatus === "failed" ||
    candidate.ownerRunStatus === "yielded" ||
    candidate.ownerRunStatus === "interrupted";
	const checkpointedYield =
    readTerminalContinuation(projectDir, candidate)?.continuationDecision ===
      "preserve-yield" &&
    candidate.worktree.uniqueCommitCount > 0 &&
		candidate.worktree.canonicalReconciliation?.disposition ===
			"ready-to-resume";
	const committedPendingMerge = isRetryableCommittedPendingMerge(candidate);
  if (
    candidate.claim.workflowId === "builder" &&
    candidate.recommendedAction.kind === "needs-review" &&
    candidate.worktree.found &&
		(candidate.worktree.dirtyState === "dirty" ||
			candidate.worktree.dirtyState === "conflicted" ||
			checkpointedYield ||
			committedPendingMerge) &&
    candidate.worktree.workspaceDir !== null &&
    recoverableOwnerRun
  ) {
    return candidate.worktree.workspaceDir;
  }
  return null;
}

export function needsRuntimeRecoveryRequest(
  projectDir: string,
  candidate: WorkflowStateRecoveryClaim,
): boolean {
  if (preservedBuilderWorkspaceDir(projectDir, candidate) === null) return false;
  if (
    candidate.worktree.canonicalReconciliation?.disposition === "needs-review" &&
    !isRetryableCommittedPendingMerge(candidate)
  ) {
    return false;
  }
  const finalizer = readTerminalContinuation(projectDir, candidate);
  if (
    finalizer?.continuationDecision === "decompose" ||
    finalizer?.continuationDecision === "needs-owner"
  ) {
    return false;
  }
  if (finalizer?.continuationDecision === "preserve-yield") return true;
  if (candidate.claim.runId === candidate.claim.worktreeRunId) return true;
  if (candidate.claim.status === "pending-merge") return true;
  return finalizer === null || finalizer.recoveryRequested === true;
}

export function builderRecoveryRequestForCandidate(
  projectDir: string,
  candidate: WorkflowStateRecoveryClaim,
): BuilderRecoveryRequest {
  const workspaceDir = preservedBuilderWorkspaceDir(projectDir, candidate);
  if (workspaceDir === null) {
    throw new Error(
      `Task ${candidate.claim.taskId} is not a terminal preserved builder candidate`,
    );
  }
  return {
    taskId: candidate.claim.taskId,
    sourceRunId: candidate.claim.runId,
    worktreeRunId: candidate.claim.worktreeRunId,
    workspaceDir,
    idempotencyKey: `builder-recovery:${candidate.claim.runId}`,
    reason: `preserved builder work from ${candidate.claim.runId} requires recovery`,
  };
}
