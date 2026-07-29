import {
  listFullRepoTasks,
  listRepoTaskDependencyWaits,
  type RepoTaskFullRecord,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { listTaskClaimInspections } from "./task-claim-files.js";
import { claimTask } from "./task-claim-operations.js";
import {
  CLAIM_CANDIDATE_STATES,
  type ClaimNextQueueTaskInput,
  type ClaimTaskAttempt,
  type QueueTaskClaimResult,
} from "./task-claim-types.js";

export {
  archiveClaim,
  archiveClaimIfUnchanged,
  buildClaim,
  inspectTaskClaim,
  inspectTaskClaimWithOwnerRun,
  listTaskClaimInspections,
  readActiveTaskClaim,
  taskClaimPath,
  writeClaim,
} from "./task-claim-files.js";
export {
  claimTask,
  continueTaskClaim,
  expireTaskClaim,
  markTaskClaimPendingMerge,
  releaseTaskClaim,
  resumeTaskClaim,
  supersedeTaskClaim,
  updateTaskClaimWorkspace,
} from "./task-claim-operations.js";
export {
  CLAIM_CANDIDATE_STATES,
  CLAIM_SCHEMA_VERSION,
  type ClaimNextQueueTaskInput,
  type ClaimTaskAttempt,
  type ClaimTaskInput,
  type ContinueTaskClaimInput,
  DEFAULT_TASK_CLAIM_LEASE_MS,
  type QueueTaskClaimResult,
  type TaskClaim,
  type TaskClaimInspection,
  type TaskClaimMutationInput,
  type TaskClaimRecoveryPath,
  type TaskClaimRecoveryStatus,
  type TaskClaimStatus,
  type TaskClaimTerminalResult,
  type TaskClaimWorkspaceInput,
} from "./task-claim-types.js";

const PRIORITY_RANK = new Map([
  ["p0", 0],
  ["p1", 1],
  ["p2", 2],
  ["p3", 3],
]);

function priorityRank(priority: string): number {
  return PRIORITY_RANK.get(priority) ?? 99;
}

function compareCandidateTasks(a: RepoTaskFullRecord, b: RepoTaskFullRecord): number {
  const stateRank = (task: RepoTaskFullRecord) => (task.state === "doing" ? 0 : 1);
  const byState = stateRank(a) - stateRank(b);
  if (byState !== 0) return byState;
  const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
  if (byPriority !== 0) return byPriority;
  const byUpdated = a.updatedAt.localeCompare(b.updatedAt);
  if (byUpdated !== 0) return byUpdated;
  return a.id.localeCompare(b.id);
}

export function claimNextQueueTask(input: ClaimNextQueueTaskInput): QueueTaskClaimResult {
  const now = input.now ?? new Date();
  const candidateStates = input.candidateStates ?? CLAIM_CANDIDATE_STATES;
  const waitingIds = new Set(
    listRepoTaskDependencyWaits(input.projectDir, candidateStates).map((wait) => wait.id),
  );
  const candidates = listFullRepoTasks(input.projectDir, candidateStates)
    .filter((task) => !waitingIds.has(task.id))
    .sort(compareCandidateTasks);
  const skipped: ClaimTaskAttempt[] = [];

  for (const task of candidates) {
    const attempt = claimTask({
      ...input,
      taskId: task.id,
      taskState: task.state,
      now,
    });
    if (attempt.claimed) {
      return {
        claimed: true,
        taskId: task.id,
        claim: attempt.claim,
        recoveryStatus: attempt.recoveryStatus,
        safeToRetry: attempt.safeToRetry,
        recoveryPath: attempt.recoveryPath,
        reason: null,
        candidateCount: candidates.length,
        skipped,
        activeClaims: listTaskClaimInspections(input.projectDir, now),
      };
    }
    skipped.push(attempt);
  }

  return {
    claimed: false,
    taskId: null,
    claim: null,
    recoveryStatus: null,
    safeToRetry: true,
    recoveryPath: "no-actionable-task",
    reason: candidates.length === 0 ? "no dependency-clear ready or doing task" : "all candidate tasks are claimed",
    candidateCount: candidates.length,
    skipped,
    activeClaims: listTaskClaimInspections(input.projectDir, now),
  };
}
