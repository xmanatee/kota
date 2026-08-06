import {
  archiveClaim,
  archiveClaimIfUnchanged,
  buildClaim,
  continueClaimIfUnchanged,
  inspectTaskClaim,
  inspectTaskClaimWithOwnerRun,
  readActiveTaskClaim,
  taskClaimPath,
  writeClaim,
} from "./task-claim-files.js";
import {
  type ClaimTaskAttempt,
  type ClaimTaskInput,
  type ContinueTaskClaimInput,
  skippedTaskClaimRecoveryPath,
  type TaskClaim,
  type TaskClaimInspection,
  type TaskClaimMutationInput,
  type TaskClaimRecoveryPath,
  type TaskClaimTerminalResult,
  type TaskClaimWorkspaceInput,
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
    const inspection = inspectTaskClaimWithOwnerRun(input.projectDir, existing, path, now);
    if (sameWorkflowRun(existing, input) && existing.status === "active") {
      const resumed = buildClaim(input, now, existing.createdAt);
      writeClaim(input.projectDir, resumed, "w");
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
      const recoveryPath = skippedTaskClaimRecoveryPath(inspection.recoveryStatus);
      return skippedAttempt(
        input.taskId,
        existing,
        inspection,
        recoveryPath,
        recoveryPath === "skipped-stale-worktree"
          ? `previous run ${existing.runId} has a preserved dirty worktree; inspect with "kota workflow state-recovery list"`
          : `task is already claimed by ${existing.owner} (${existing.runId})`,
      );
    }
    if (!archiveClaimIfUnchanged(input.projectDir, existing, now)) {
      return skippedAttempt(input.taskId, null, null, "write-conflict", "claim changed during stale recovery");
    }
  }

  const claim = buildClaim(input, now);
  try {
    writeClaim(input.projectDir, claim, "wx");
  } catch {
    const conflict = readActiveTaskClaim(input.projectDir, input.taskId);
    const inspection = conflict ? inspectTaskClaimWithOwnerRun(input.projectDir, conflict, path, now) : null;
    return skippedAttempt(input.taskId, conflict, inspection, "write-conflict", "claim write lost an atomic race");
  }
  const recoveryPath =
    existing?.status === "expired"
      ? "replaced-expired-claim"
      : existing?.status === "superseded"
        ? "replaced-superseded-claim"
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

export function continueTaskClaim(
  input: ContinueTaskClaimInput,
): ClaimTaskAttempt {
  const path = taskClaimPath(input.projectDir, input.taskId);
  const current = readActiveTaskClaim(input.projectDir, input.taskId);
  if (!current) {
    return skippedAttempt(
      input.taskId,
      null,
      null,
      "write-conflict",
      "preserved task claim no longer exists",
    );
  }
  const inspection = inspectTaskClaimWithOwnerRun(
    input.projectDir,
    current,
    path,
    input.now,
  );
  if (
    current.runId !== input.sourceRunId ||
    current.workflowId !== input.workflowId
  ) {
    return skippedAttempt(
      input.taskId,
      current,
      inspection,
      "write-conflict",
      `claim belongs to ${current.workflowId}/${current.runId}`,
    );
  }
  if (inspection.recoveryStatus !== "stale") {
    return skippedAttempt(
      input.taskId,
      current,
      inspection,
      "skipped-active-claim",
      `claim is ${inspection.recoveryStatus}, not a terminal preserved claim`,
    );
  }

  const continued = continueClaimIfUnchanged(
    input.projectDir,
    current,
    input,
  );
  if (!continued) {
    return skippedAttempt(
      input.taskId,
      readActiveTaskClaim(input.projectDir, input.taskId),
      null,
      "write-conflict",
      "claim changed during recovery continuation",
    );
  }
  return {
    claimed: true,
    taskId: input.taskId,
    claim: continued,
    recoveryStatus: "agent-running",
    safeToRetry: false,
    recoveryPath: "continued-preserved-claim",
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
    recoveryStatus: inspectTaskClaimWithOwnerRun(input.projectDir, claim, path, now).recoveryStatus,
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
  writeClaim(input.projectDir, next, "w");
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

export function markTaskClaimPendingDecomposition(
  input: TaskClaimMutationInput,
): TaskClaimTerminalResult {
  return mutateActiveClaim(input, (claim, now) => ({
    ...claim,
    status: "pending-decomposition",
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
  writeClaim(input.projectDir, released, "w");
  archiveClaim(input.projectDir, released, now);
  return {
    taskId: input.taskId,
    changed: true,
    claim: released,
    recoveryStatus: "released",
    safeToRetry: true,
    reason: null,
  };
}

export function supersedeTaskClaim(input: TaskClaimMutationInput): TaskClaimTerminalResult {
  const now = input.now ?? new Date();
  const path = taskClaimPath(input.projectDir, input.taskId);
  const claim = readActiveTaskClaim(input.projectDir, input.taskId);
  if (!claim) return missingResult(input.taskId);
  if (!mutationActorMatches(claim, input)) return mismatchResult(claim, path, input, now);

  const superseded = {
    ...claim,
    status: "superseded" as const,
    updatedAt: now.toISOString(),
    evidence: input.evidence,
  };
  writeClaim(input.projectDir, superseded, "w");
  archiveClaim(input.projectDir, superseded, now);
  return {
    taskId: input.taskId,
    changed: true,
    claim: superseded,
    recoveryStatus: "superseded",
    safeToRetry: true,
    reason: null,
  };
}
