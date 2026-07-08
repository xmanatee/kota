import {
  type DeadLetterItem,
  deadLetterStoreForProject,
} from "#core/daemon/dead-letter-queue.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type {
  WorkflowStateRecoveryClaim,
  WorkflowStateRecoveryClaimSnapshot,
  WorkflowStateRecoveryDeadLetterLink,
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

function deadLetterLink(item: DeadLetterItem): WorkflowStateRecoveryDeadLetterLink {
  return {
    id: item.id,
    status: item.status,
    type: item.type,
    affectedWorkflowNames: [...item.affectedWorkflowNames],
    reason: item.failure.reason,
    dismissCommand: `pnpm kota workflow dlq dismiss ${item.id} --reason "<reason>"`,
    redriveCommand: `pnpm kota workflow dlq redrive ${item.id} --reason "<reason>"`,
  };
}

function relatedDeadLetters(
  projectDir: string,
  claim: TaskClaim,
): WorkflowStateRecoveryDeadLetterLink[] {
  const scopeId = deriveDirectoryScopeId(projectDir);
  return deadLetterStoreForProject(projectDir)
    .list({
      status: "open",
      workflowName: claim.workflowId,
      scopeId,
      limit: 200,
    })
    .filter((item) => deadLetterMentionsRun(item, claim.runId))
    .map(deadLetterLink);
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

export function findPendingMergeClaim(
  projectDir: string,
  taskId: string,
): WorkflowStateRecoveryClaim | null {
  return listPendingMergeClaims(projectDir).find((claim) => claim.claim.taskId === taskId) ?? null;
}
