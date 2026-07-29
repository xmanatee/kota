import { existsSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import {
  continueTaskClaim,
  DEFAULT_TASK_CLAIM_LEASE_MS,
  listTaskClaimInspections,
  type QueueTaskClaimResult,
  type TaskClaim,
} from "#modules/autonomy/task-claims.js";
import {
  findRecoveryClaim,
  listRecoveryClaims,
} from "#modules/autonomy/workflow-state-recovery-claims.js";
import type { WorkflowStateRecoveryClaim } from "#modules/workflow-ops/state-recovery-provider.js";

export const BUILDER_RECOVERY_EVENT = "autonomy.builder.recovery.requested";

export type BuilderRecoveryRequest = {
  taskId: string;
  sourceRunId: string;
  worktreeRunId: string;
  workspaceDir: string;
  idempotencyKey: string;
  reason: string;
};

export type BuilderRecoveryDispatchResult = {
  candidateCount: number;
  requested: BuilderRecoveryRequest[];
};

function requiredPayloadString(
  payload: WorkflowStepContext["trigger"]["payload"],
  key: keyof BuilderRecoveryRequest,
): string {
  const value = payload[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Builder recovery trigger payload.${key} must be a non-empty string`);
  }
  return value;
}

export function builderRecoveryRequestFromTrigger(
  trigger: WorkflowStepContext["trigger"],
): BuilderRecoveryRequest | null {
  if (trigger.event !== BUILDER_RECOVERY_EVENT) return null;
  return {
    taskId: requiredPayloadString(trigger.payload, "taskId"),
    sourceRunId: requiredPayloadString(trigger.payload, "sourceRunId"),
    worktreeRunId: requiredPayloadString(trigger.payload, "worktreeRunId"),
    workspaceDir: requiredPayloadString(trigger.payload, "workspaceDir"),
    idempotencyKey: requiredPayloadString(trigger.payload, "idempotencyKey"),
    reason: requiredPayloadString(trigger.payload, "reason"),
  };
}

function preservedBuilderWorkspaceDir(
  candidate: WorkflowStateRecoveryClaim,
): string | null {
  if (
    candidate.claim.workflowId === "builder" &&
    candidate.recommendedAction.kind === "needs-review" &&
    candidate.worktree.found &&
    (candidate.worktree.dirtyState === "dirty" ||
      candidate.worktree.dirtyState === "conflicted") &&
    candidate.worktree.workspaceDir !== null &&
    (candidate.ownerRunStatus === "failed" ||
      candidate.ownerRunStatus === "interrupted")
  ) {
    return candidate.worktree.workspaceDir;
  }
  return null;
}

function needsRuntimeRecoveryRequest(
  projectDir: string,
  candidate: WorkflowStateRecoveryClaim,
): boolean {
  if (preservedBuilderWorkspaceDir(candidate) === null) return false;
  if (candidate.claim.runId === candidate.claim.worktreeRunId) return true;
  return !existsSync(
    join(
      projectDir,
      ".kota",
      "runs",
      candidate.claim.runId,
      "terminal-worktree-finalizer.json",
    ),
  );
}

export function builderRecoveryRequestForCandidate(
  candidate: WorkflowStateRecoveryClaim,
  reason: string,
): BuilderRecoveryRequest {
  const workspaceDir = preservedBuilderWorkspaceDir(candidate);
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
    reason,
  };
}

export function emitBuilderRecoveryRequest(
  emit: WorkflowStepContext["emit"],
  request: BuilderRecoveryRequest,
): void {
  emit(BUILDER_RECOVERY_EVENT, request);
}

export function requestPendingBuilderRecoveries(
  ctx: Pick<WorkflowStepContext, "projectDir" | "emit">,
): BuilderRecoveryDispatchResult {
  const candidates = listRecoveryClaims(ctx.projectDir).filter(
    (candidate) => needsRuntimeRecoveryRequest(ctx.projectDir, candidate),
  );
  const requested = candidates.map((candidate) =>
    builderRecoveryRequestForCandidate(
      candidate,
      `runtime recovery found preserved builder work from ${candidate.claim.runId}`,
    ),
  );
  for (const request of requested) {
    emitBuilderRecoveryRequest(ctx.emit, request);
  }
  return { candidateCount: candidates.length, requested };
}

function continuedClaimResult(
  projectDir: string,
  claim: TaskClaim,
): QueueTaskClaimResult {
  return {
    claimed: true,
    taskId: claim.taskId,
    claim,
    recoveryStatus: "agent-running",
    safeToRetry: false,
    recoveryPath: "continued-preserved-claim",
    reason: null,
    candidateCount: 1,
    skipped: [],
    activeClaims: listTaskClaimInspections(projectDir),
  };
}

export function claimBuilderRecovery(
  ctx: Pick<WorkflowStepContext, "projectDir" | "trigger" | "workflow">,
): QueueTaskClaimResult {
  const request = builderRecoveryRequestFromTrigger(ctx.trigger);
  if (request === null) {
    throw new Error("claimBuilderRecovery requires a builder recovery trigger");
  }
  const candidate = findRecoveryClaim(ctx.projectDir, request.taskId);
  if (!candidate || preservedBuilderWorkspaceDir(candidate) === null) {
    throw new Error(`Preserved builder recovery candidate is unavailable for ${request.taskId}`);
  }
  if (
    candidate.claim.runId !== request.sourceRunId ||
    candidate.claim.worktreeRunId !== request.worktreeRunId ||
    candidate.worktree.workspaceDir !== request.workspaceDir
  ) {
    throw new Error(
      `Builder recovery evidence changed for ${request.taskId}; refusing stale continuation request`,
    );
  }

  const attempt = continueTaskClaim({
    projectDir: ctx.projectDir,
    taskId: request.taskId,
    sourceRunId: request.sourceRunId,
    runId: ctx.workflow.runId,
    workflowId: "builder",
    owner: "workflow:builder",
    evidence: `continuing preserved builder worktree ${request.worktreeRunId}: ${request.reason}`,
    leaseMs: DEFAULT_TASK_CLAIM_LEASE_MS,
  });
  if (!attempt.claimed || !attempt.claim) {
    throw new Error(
      attempt.reason ?? `Failed to continue preserved task claim ${request.taskId}`,
    );
  }
  return continuedClaimResult(ctx.projectDir, attempt.claim);
}
