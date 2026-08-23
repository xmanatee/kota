import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { validateWorkflowRunId } from "#core/workflow/run-io.js";
import type { WorkflowRunMetadata, WorkflowStepContext } from "#core/workflow/run-types.js";
import {
  type ClaimTaskAttempt,
  compareQueueTaskCandidates,
  continueTaskClaim,
  DEFAULT_TASK_CLAIM_LEASE_MS,
  listClaimableQueueTaskCandidates,
  listTaskClaimInspections,
  type QueueTaskClaimResult,
  type TaskClaim,
} from "#modules/autonomy/task-claims.js";
import { listRecoveryClaims } from "#modules/autonomy/workflow-state-recovery-claims.js";
import {
  listFullRepoTasks,
  type RepoTaskFullRecord,
} from "#modules/repo-tasks/repo-tasks-domain.js";
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

function preservedBuilderWorkspaceDir(
  candidate: WorkflowStateRecoveryClaim,
): string | null {
  const recoverableOwnerRun =
    candidate.claim.status === "pending-merge" ||
    candidate.ownerRunStatus === "failed" ||
    candidate.ownerRunStatus === "interrupted";
  if (
    candidate.claim.workflowId === "builder" &&
    candidate.recommendedAction.kind === "needs-review" &&
    candidate.worktree.found &&
    (candidate.worktree.dirtyState === "dirty" ||
      candidate.worktree.dirtyState === "conflicted") &&
    candidate.worktree.workspaceDir !== null &&
    recoverableOwnerRun
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
  if (
    candidate.worktree.canonicalReconciliation?.disposition === "needs-review"
  ) {
    return false;
  }
  if (candidate.claim.runId === candidate.claim.worktreeRunId) return true;
  if (candidate.claim.status === "pending-merge") return true;
  const finalizer = readOptionalJsonFile<{ recoveryRequested?: boolean }>(
    join(
      projectDir,
      ".kota",
      "runs",
      candidate.claim.runId,
      "terminal-worktree-finalizer.json",
    ),
  );
  return finalizer === null || finalizer.recoveryRequested === true;
}

export function listPendingBuilderRecoveries(
  projectDir: string,
): WorkflowStateRecoveryClaim[] {
  return listRecoveryClaims(projectDir)
    .filter((candidate) => needsRuntimeRecoveryRequest(projectDir, candidate))
    .sort((a, b) => {
      const byUpdated = a.claim.updatedAt.localeCompare(b.claim.updatedAt);
      return byUpdated !== 0
        ? byUpdated
        : a.claim.taskId.localeCompare(b.claim.taskId);
    });
}

export function builderRecoveryRequestForCandidate(
  candidate: WorkflowStateRecoveryClaim,
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
    reason: `preserved builder work from ${candidate.claim.runId} requires recovery`,
  };
}

export function emitBuilderRecoveryRequest(
  emit: WorkflowStepContext["emit"],
  request: BuilderRecoveryRequest,
): void {
  emit(BUILDER_RECOVERY_EVENT, request);
}

export function inspectPendingBuilderRecoveriesInWorker(input: {
  projectDir: string;
}): BuilderRecoveryDispatchResult {
  const candidates = listPendingBuilderRecoveries(input.projectDir);
  const taskById = new Map<string, RepoTaskFullRecord>(
    listFullRepoTasks(input.projectDir, ["ready", "doing"]).map((task) => [
      task.id,
      task,
    ]),
  );
  const rankedCandidates = candidates
    .map((candidate) => ({ candidate, task: taskById.get(candidate.claim.taskId) }))
    .filter(
      (entry): entry is { candidate: WorkflowStateRecoveryClaim; task: RepoTaskFullRecord } =>
        entry.task !== undefined,
    )
    .sort((a, b) => compareQueueTaskCandidates(a.task, b.task));
  const recoveryTaskIds = new Set(candidates.map((candidate) => candidate.claim.taskId));
  const queueFrontier = listClaimableQueueTaskCandidates(input.projectDir).find(
    (task) => !recoveryTaskIds.has(task.id),
  );
  const selected = rankedCandidates[0];
  const requested = selected &&
      (!queueFrontier || compareQueueTaskCandidates(selected.task, queueFrontier) <= 0)
    ? [builderRecoveryRequestForCandidate(selected.candidate)]
    : [];
  return { candidateCount: candidates.length, requested };
}

export const inspectPendingBuilderRecoveriesOperation =
  defineWorkflowBlockingOperation<
    { projectDir: string },
    BuilderRecoveryDispatchResult
  >(import.meta.url, "inspectPendingBuilderRecoveriesInWorker");

function requestedBuilderRecovery(
  ctx: Pick<WorkflowStepContext, "projectDir" | "trigger">,
): WorkflowStateRecoveryClaim[] | null {
  if (ctx.trigger.event !== BUILDER_RECOVERY_EVENT) return null;
  const { taskId, sourceRunId, worktreeRunId, workspaceDir } = ctx.trigger.payload;
  if (
    typeof taskId !== "string" ||
    typeof sourceRunId !== "string" ||
    typeof worktreeRunId !== "string" ||
    typeof workspaceDir !== "string"
  ) {
    return [];
  }
  const retryOf = ctx.trigger.payload.retryOf;
  return listRecoveryClaims(ctx.projectDir).filter((candidate) =>
    candidate.claim.taskId === taskId &&
    candidate.claim.worktreeRunId === worktreeRunId &&
    preservedBuilderWorkspaceDir(candidate) === workspaceDir &&
    (
      candidate.claim.runId === sourceRunId ||
      retryLineageContainsClaimOwner(
        ctx.projectDir,
        typeof retryOf === "string" ? retryOf : null,
        candidate.claim.runId,
      )
    )
  );
}

function retryLineageContainsClaimOwner(
  projectDir: string,
  retryOf: string | null,
  claimRunId: string,
): boolean {
  let currentRunId = retryOf;
  const visited = new Set<string>();
  while (currentRunId !== null) {
    validateWorkflowRunId(currentRunId, "Builder recovery retry lineage");
    if (currentRunId === claimRunId) return true;
    if (visited.has(currentRunId)) {
      throw new Error(
        `Builder recovery retry lineage contains a cycle at ${currentRunId}`,
      );
    }
    visited.add(currentRunId);
    const metadata = readOptionalJsonFile<WorkflowRunMetadata>(
      join(projectDir, ".kota", "runs", currentRunId, "metadata.json"),
    );
    if (metadata === null) {
      throw new Error(
        `Builder recovery retry lineage run ${currentRunId} is unavailable`,
      );
    }
    if (metadata.id !== currentRunId || metadata.workflow !== "builder") {
      throw new Error(
        `Builder recovery retry lineage run ${currentRunId} is not valid builder metadata`,
      );
    }
    if (metadata.retryOf !== undefined && typeof metadata.retryOf !== "string") {
      throw new Error(
        `Builder recovery retry lineage run ${currentRunId} has an invalid retryOf`,
      );
    }
    currentRunId = metadata.retryOf ?? null;
  }
  return false;
}

function continuedClaimResult(
  projectDir: string,
  claim: TaskClaim,
  candidateCount: number,
  skipped: ClaimTaskAttempt[] = [],
): QueueTaskClaimResult {
  return {
    claimed: true,
    taskId: claim.taskId,
    claim,
    recoveryStatus: "agent-running",
    safeToRetry: false,
    recoveryPath: "continued-preserved-claim",
    reason: null,
    candidateCount,
    skipped,
    activeClaims: listTaskClaimInspections(projectDir),
  };
}

function continueRecoveryCandidate(
  ctx: Pick<WorkflowStepContext, "projectDir" | "workflow">,
  candidate: WorkflowStateRecoveryClaim,
  reason: string,
): ClaimTaskAttempt {
  return continueTaskClaim({
    projectDir: ctx.projectDir,
    taskId: candidate.claim.taskId,
    sourceRunId: candidate.claim.runId,
    runId: ctx.workflow.runId,
    workflowId: "builder",
    owner: "workflow:builder",
    evidence: `continuing preserved builder worktree ${candidate.claim.worktreeRunId}: ${reason}`,
    leaseMs: DEFAULT_TASK_CLAIM_LEASE_MS,
  });
}

export function claimPendingBuilderRecovery(
  ctx: Pick<WorkflowStepContext, "projectDir" | "trigger" | "workflow">,
): QueueTaskClaimResult | null {
  const candidates = requestedBuilderRecovery(ctx);
  if (candidates === null) return null;
  const skipped: ClaimTaskAttempt[] = [];
  for (const candidate of candidates) {
    const attempt = continueRecoveryCandidate(
      ctx,
      candidate,
      `builder accepted requested recovery for ${candidate.claim.worktreeRunId}`,
    );
    if (attempt.claimed && attempt.claim) {
      return continuedClaimResult(
        ctx.projectDir,
        attempt.claim,
        candidates.length,
        skipped,
      );
    }
    skipped.push(attempt);
  }
  return null;
}

export function unavailableBuilderRecoveryResult(
  projectDir: string,
): QueueTaskClaimResult {
  return {
    claimed: false,
    taskId: null,
    claim: null,
    recoveryStatus: null,
    safeToRetry: true,
    recoveryPath: "no-actionable-task",
    reason: "no pending preserved builder recovery",
    candidateCount: 0,
    skipped: [],
    activeClaims: listTaskClaimInspections(projectDir),
  };
}
