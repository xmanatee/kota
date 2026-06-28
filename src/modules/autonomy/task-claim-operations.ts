import { existsSync, unlinkSync } from "node:fs";
import {
  archiveClaim,
  archiveClaimIfUnchanged,
  buildClaim,
  inspectTaskClaim,
  readActiveTaskClaim,
  taskClaimPath,
  writeClaim,
} from "./task-claim-files.js";
import type {
  ClaimTaskAttempt,
  ClaimTaskInput,
  TaskClaim,
  TaskClaimInspection,
  TaskClaimMutationInput,
  TaskClaimRecoveryPath,
  TaskClaimTerminalResult,
  TaskClaimWorkspaceInput,
} from "./task-claim-types.js";

function sameWorkflowRun(existing: TaskClaim, input: ClaimTaskInput): boolean {
  return existing.taskId === input.taskId &&
    existing.runId === input.runId &&
    existing.workflowId === input.workflowId;
}

function skippedAttempt(
  taskId: string,
  claim: TaskClaim | null,
  inspection: TaskClaimInspection | null,
  recoveryPath: TaskClaimRecoveryPath,
  reason: string,
): ClaimTaskAttempt {
  return {
    claimed: false,
    taskId,
    claim,
    recoveryStatus: inspection?.recoveryStatus ?? null,
    safeToRetry: inspection?.safeToRetry ?? false,
    recoveryPath,
    reason,
  };
}

export function claimTask(input: ClaimTaskInput): ClaimTaskAttempt {
  const now = input.now ?? new Date();
  const path = taskClaimPath(input.projectDir, input.taskId);
  const existing = readActiveTaskClaim(input.projectDir, input.taskId);

  if (existing) {
    const inspection = inspectTaskClaim(existing, path, now);
    if (sameWorkflowRun(existing, input) && existing.status === "active") {
      const resumed = buildClaim(input, now, existing.createdAt);
      writeClaim(path, resumed, "w");
      return {
        claimed: true,
        taskId: input.taskId,
        claim: resumed,
        recoveryStatus: "agent-running",
        safeToRetry: false,
        recoveryPath: inspection.recoveryStatus === "stale" ? "resumed-stale-claim" : "resumed-active-claim",
        reason: null,
      };
    }
    if (!inspection.safeToRetry) {
      return skippedAttempt(
        input.taskId,
        existing,
        inspection,
        inspection.recoveryStatus === "pending-merge" ? "skipped-pending-merge" : "skipped-active-claim",
        `task is already claimed by ${existing.owner} (${existing.runId})`,
      );
    }
    if (!archiveClaimIfUnchanged(input.projectDir, path, existing, now)) {
      return skippedAttempt(input.taskId, null, null, "write-conflict", "claim changed during stale recovery");
    }
  }

  const claim = buildClaim(input, now);
  try {
    writeClaim(path, claim, "wx");
  } catch {
    const conflict = readActiveTaskClaim(input.projectDir, input.taskId);
    const inspection = conflict ? inspectTaskClaim(conflict, path, now) : null;
    return skippedAttempt(input.taskId, conflict, inspection, "write-conflict", "claim write lost an atomic race");
  }
  const recoveryPath =
    existing?.status === "expired"
      ? "replaced-expired-claim"
      : existing
        ? "replaced-stale-claim"
        : "new-claim";
  return {
    claimed: true,
    taskId: input.taskId,
    claim,
    recoveryStatus: "agent-running",
    safeToRetry: false,
    recoveryPath,
    reason: null,
  };
}

function mutationActorMatches(claim: TaskClaim, input: TaskClaimMutationInput): boolean {
  return claim.taskId === input.taskId &&
    claim.runId === input.runId &&
    claim.workflowId === input.workflowId;
}

function mismatchResult(
  claim: TaskClaim,
  path: string,
  input: TaskClaimMutationInput,
  now: Date,
): TaskClaimTerminalResult {
  return {
    taskId: input.taskId,
    changed: false,
    claim,
    recoveryStatus: inspectTaskClaim(claim, path, now).recoveryStatus,
    safeToRetry: false,
    reason: `claim belongs to ${claim.workflowId}/${claim.runId}`,
  };
}

function missingResult(taskId: string): TaskClaimTerminalResult {
  return {
    taskId,
    changed: false,
    claim: null,
    recoveryStatus: "released",
    safeToRetry: true,
    reason: "no active claim",
  };
}

function mutateActiveClaim(
  input: TaskClaimMutationInput,
  mutate: (claim: TaskClaim, now: Date) => TaskClaim,
): TaskClaimTerminalResult {
  const now = input.now ?? new Date();
  const path = taskClaimPath(input.projectDir, input.taskId);
  const claim = readActiveTaskClaim(input.projectDir, input.taskId);
  if (!claim) return missingResult(input.taskId);
  if (!mutationActorMatches(claim, input)) return mismatchResult(claim, path, input, now);

  const next = mutate(claim, now);
  writeClaim(path, next, "w");
  const inspection = inspectTaskClaim(next, path, now);
  return {
    taskId: input.taskId,
    changed: true,
    claim: next,
    recoveryStatus: inspection.recoveryStatus,
    safeToRetry: inspection.safeToRetry,
    reason: null,
  };
}

export function resumeTaskClaim(input: TaskClaimMutationInput): TaskClaimTerminalResult {
  return mutateActiveClaim(input, (claim, now) => {
    const leaseMs = input.leaseMs ?? claim.leaseMs;
    return {
      ...claim,
      status: "active",
      leaseMs,
      leaseAcquiredAt: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      updatedAt: now.toISOString(),
      evidence: input.evidence,
    };
  });
}

export function expireTaskClaim(input: TaskClaimMutationInput): TaskClaimTerminalResult {
  return mutateActiveClaim(input, (claim, now) => ({
    ...claim,
    status: "expired",
    updatedAt: now.toISOString(),
    evidence: input.evidence,
  }));
}

export function markTaskClaimPendingMerge(input: TaskClaimMutationInput): TaskClaimTerminalResult {
  return mutateActiveClaim(input, (claim, now) => ({
    ...claim,
    status: "pending-merge",
    updatedAt: now.toISOString(),
    evidence: input.evidence,
  }));
}

export function updateTaskClaimWorkspace(input: TaskClaimWorkspaceInput): TaskClaimTerminalResult {
  return mutateActiveClaim(input, (claim, now) => ({
    ...claim,
    workspaceDir: input.workspaceDir,
    branch: input.branch,
    baseCommit: input.baseCommit,
    updatedAt: now.toISOString(),
    evidence: input.evidence,
  }));
}

export function releaseTaskClaim(input: TaskClaimMutationInput): TaskClaimTerminalResult {
  const now = input.now ?? new Date();
  const path = taskClaimPath(input.projectDir, input.taskId);
  const claim = readActiveTaskClaim(input.projectDir, input.taskId);
  if (!claim) return missingResult(input.taskId);
  if (!mutationActorMatches(claim, input)) return mismatchResult(claim, path, input, now);

  const released = {
    ...claim,
    status: "released" as const,
    updatedAt: now.toISOString(),
    evidence: input.evidence,
  };
  writeClaim(path, released, "w");
  archiveClaim(input.projectDir, path, released, now);
  if (existsSync(path)) unlinkSync(path);
  return {
    taskId: input.taskId,
    changed: true,
    claim: released,
    recoveryStatus: "released",
    safeToRetry: true,
    reason: null,
  };
}
