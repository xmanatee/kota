import {
  type DeadLetterItem,
  deadLetterDuplicateFingerprint,
  deadLetterStoreForProject,
  deadLetterWorkflowName,
} from "#core/daemon/dead-letter-queue.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import {
  type AutomationWorktreeUniqueCommits,
  listAutomationWorktreeStatuses,
  listAutomationWorktreeUniqueCommits,
} from "#modules/git/worktree-lifecycle.js";
import type {
  WorkflowStateRecoveryClaim,
  WorkflowStateRecoveryClaimSnapshot,
  WorkflowStateRecoveryDeadLetterLink,
  WorkflowStateRecoveryRecommendedAction,
  WorkflowStateRecoveryWorktree,
} from "#modules/workflow-ops/state-recovery-provider.js";
import {
  listTaskClaimInspections,
  type TaskClaim,
  type TaskClaimInspection,
} from "./task-claims.js";
import {
  readOwnerRunStatus,
  readWorktreeEvidence,
  recommendedActionFor,
} from "./workflow-state-recovery-worktree.js";

function claimSnapshot(claim: TaskClaim): WorkflowStateRecoveryClaimSnapshot {
  return {
    taskId: claim.taskId,
    taskState: claim.taskState,
    runId: claim.runId,
    workflowId: claim.workflowId,
    owner: claim.owner,
    workspaceDir: claim.workspaceDir,
    branch: claim.branch,
    baseCommit: claim.baseCommit,
    status: claim.status,
    evidence: claim.evidence,
    updatedAt: claim.updatedAt,
  };
}

function deadLetterMentionsRun(item: DeadLetterItem, runId: string): boolean {
  if (item.source.kind === "workflow-dispatch") {
    if (item.source.failedRunId === runId) return true;
    if (item.source.runDir?.includes(runId)) return true;
  }
  if (item.redrive.kind === "workflow") {
    const source = item.redrive.source;
    if (source.kind === "run-trigger" && source.runId === runId) return true;
    if (source.kind === "resume-step" && source.runId === runId) return true;
  }
  if (item.sourceEventIds.includes(runId)) return true;
  if (item.failure.reason.includes(runId)) return true;
  return JSON.stringify(item.redactedProjection).includes(runId);
}

function deadLetterRecommendedAction(
  item: DeadLetterItem,
  duplicateCount: number,
  duplicateOf: string | undefined,
): WorkflowStateRecoveryRecommendedAction {
  if (duplicateOf !== undefined) {
    return {
      kind: "dismiss-dlq",
      reason: `duplicate of ${duplicateOf} for the same workflow/error fingerprint`,
    };
  }
  if (item.failure.lastErrorClass === "provider" && duplicateCount > 1) {
    return {
      kind: "needs-review",
      reason: `primary provider incident with ${duplicateCount - 1} duplicate DLQ item(s)`,
    };
  }
  return {
    kind: "needs-review",
    reason: "open DLQ item needs redrive, dismissal, or linked recovery evidence",
  };
}

function deadLetterLink(
  item: DeadLetterItem,
  duplicateFingerprint = deadLetterDuplicateFingerprint(item),
  duplicateCount = 1,
  duplicateOf?: string,
): WorkflowStateRecoveryDeadLetterLink {
  const workflowName = deadLetterWorkflowName(item);
  return {
    id: item.id,
    status: item.status,
    type: item.type,
    failureClass: item.failure.lastErrorClass,
    sourceKind: item.source.kind,
    ...(workflowName !== undefined ? { workflowName } : {}),
    affectedWorkflowNames: [...item.affectedWorkflowNames],
    reason: item.failure.reason,
    duplicateFingerprint,
    duplicateCount,
    ...(duplicateOf !== undefined ? { duplicateOf } : {}),
    recommendedAction: deadLetterRecommendedAction(item, duplicateCount, duplicateOf),
    dismissCommand: `pnpm kota workflow dlq dismiss ${item.id} --reason "<reason>"`,
    redriveCommand: `pnpm kota workflow dlq redrive ${item.id} --reason "<reason>"`,
  };
}

function projectDeadLetterLinks(items: DeadLetterItem[]): WorkflowStateRecoveryDeadLetterLink[] {
  const sorted = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const groups = new Map<string, DeadLetterItem[]>();
  for (const item of sorted) {
    const fingerprint = deadLetterDuplicateFingerprint(item);
    groups.set(fingerprint, [...(groups.get(fingerprint) ?? []), item]);
  }
  return sorted.map((item) => {
    const fingerprint = deadLetterDuplicateFingerprint(item);
    const group = groups.get(fingerprint) ?? [item];
    const primary = group[0];
    return deadLetterLink(
      item,
      fingerprint,
      group.length,
      primary && primary.id !== item.id ? primary.id : undefined,
    );
  });
}

function relatedDeadLetters(
  projectDir: string,
  claim: TaskClaim,
): WorkflowStateRecoveryDeadLetterLink[] {
  const scopeId = deriveDirectoryScopeId(projectDir);
  const items = deadLetterStoreForProject(projectDir)
    .list({
      status: "open",
      workflowName: claim.workflowId,
      scopeId,
      limit: 200,
    })
    .filter((item) => deadLetterMentionsRun(item, claim.runId));
  return projectDeadLetterLinks(items);
}

function relatedDeadLettersForRun(
  projectDir: string,
  workflowId: string,
  runId: string,
): WorkflowStateRecoveryDeadLetterLink[] {
  const scopeId = deriveDirectoryScopeId(projectDir);
  const items = deadLetterStoreForProject(projectDir)
    .list({
      status: "open",
      workflowName: workflowId,
      scopeId,
      limit: 500,
    })
    .filter((item) => deadLetterMentionsRun(item, runId));
  return projectDeadLetterLinks(items);
}

function recommendedActionForWorktree(
  worktree: ReturnType<typeof listAutomationWorktreeStatuses>[number],
  unique: AutomationWorktreeUniqueCommits,
): WorkflowStateRecoveryRecommendedAction {
  if (worktree.runState === "active") {
    return { kind: "active", reason: "owning workflow run is still active" };
  }
  if (worktree.dirtyState === "conflicted") {
    return { kind: "needs-review", reason: "worktree has conflicted paths" };
  }
  if (unique.error !== undefined) {
    return { kind: "needs-review", reason: unique.error };
  }
  if (unique.commits.length > 0) {
    return {
      kind: "needs-review",
      reason: "branch has commits that are not proven merged or superseded",
    };
  }
  if (worktree.state === "stale" || worktree.cleanupStatus === "eligible") {
    return {
      kind: "cleanup",
      reason: "terminal automation worktree has no branch-only commits",
    };
  }
  if (worktree.state === "pending-merge") {
    return {
      kind: "needs-review",
      reason: "pending-merge worktree needs a release or supersede disposition",
    };
  }
  if (worktree.cleanupStatus === "removed") {
    return { kind: "wait", reason: "worktree metadata is already removed" };
  }
  return { kind: "wait", reason: "worktree has no terminal cleanup disposition yet" };
}

export function projectClaim(
  projectDir: string,
  inspection: TaskClaimInspection,
): WorkflowStateRecoveryClaim {
  const ownerRunStatus = readOwnerRunStatus(projectDir, inspection.claim);
  const worktree = readWorktreeEvidence(projectDir, inspection.claim);
  return {
    claim: claimSnapshot(inspection.claim),
    claimPath: inspection.path,
    recoveryStatus: inspection.recoveryStatus,
    safeToRetry: inspection.safeToRetry,
    ownerRunStatus,
    worktree,
    relatedDeadLetters: relatedDeadLetters(projectDir, inspection.claim),
    recommendedAction: recommendedActionFor(
      inspection.claim,
      ownerRunStatus,
      worktree,
    ),
  };
}

export function listPendingMergeClaims(projectDir: string): WorkflowStateRecoveryClaim[] {
  return listTaskClaimInspections(projectDir)
    .filter((inspection) => inspection.claim.status === "pending-merge")
    .map((inspection) => projectClaim(projectDir, inspection))
    .sort((a, b) => a.claim.taskId.localeCompare(b.claim.taskId));
}

export function listRecoveryWorktrees(projectDir: string): WorkflowStateRecoveryWorktree[] {
  return listAutomationWorktreeStatuses(projectDir)
    .filter((worktree) => worktree.cleanupStatus !== "removed")
    .map((worktree) => {
      const unique = listAutomationWorktreeUniqueCommits(
        projectDir,
        worktree.branch || worktree.headCommit,
      );
      return {
        taskId: worktree.taskId,
        runId: worktree.runId,
        workflowId: worktree.workflowId,
        owner: worktree.owner,
        metadataPath: worktree.metadataPath,
        workspaceDir: worktree.workspaceDir,
        branch: worktree.branch,
        state: worktree.state,
        metadataState: worktree.metadataState,
        runState: worktree.runState,
        dirtyState: worktree.dirtyState,
        dirtyEntries: worktree.dirtyEntries,
        cleanupBlockers: worktree.cleanupBlockers,
        mergeStatus: worktree.mergeStatus,
        headCommit: worktree.headCommit,
        uniqueCommits: unique.commits,
        uniqueCommitCount: unique.commits.length,
        ...(unique.error !== undefined ? { uniqueCommitError: unique.error } : {}),
        branchAhead: unique.branchAhead,
        branchBehind: unique.branchBehind,
        relatedDeadLetters: relatedDeadLettersForRun(
          projectDir,
          worktree.workflowId,
          worktree.runId,
        ),
        recommendedAction: recommendedActionForWorktree(
          worktree,
          unique,
        ),
      };
    })
    .sort((a, b) => `${a.taskId}/${a.runId}`.localeCompare(`${b.taskId}/${b.runId}`));
}

export function listRecoveryDeadLetters(projectDir: string): WorkflowStateRecoveryDeadLetterLink[] {
  const scopeId = deriveDirectoryScopeId(projectDir);
  return projectDeadLetterLinks(
    deadLetterStoreForProject(projectDir).list({
      status: "open",
      scopeId,
      limit: 500,
    }),
  );
}

export function findPendingMergeClaim(
  projectDir: string,
  taskId: string,
): WorkflowStateRecoveryClaim | null {
  return listPendingMergeClaims(projectDir).find((claim) => claim.claim.taskId === taskId) ?? null;
}
