import {
  listVerifiedFullRepoTasks,
  type RepoTaskFileDescriptor,
  type RepoTaskFullRecord,
  readVerifiedRepoTaskFile,
  type VerifiedRepoTaskFullRecord,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { listTaskClaimInspections } from "./task-claim-files.js";
import { claimTask } from "./task-claim-operations.js";
import {
  CLAIM_CANDIDATE_STATES,
  type ClaimNextQueueTaskInput,
  type ClaimTaskAttempt,
  type QueueTaskClaimResult,
} from "./task-claim-types.js";
import { compareAutonomyTasks } from "./task-ranking.js";

export { updateTaskClaimCanonicalReconciliation } from "./task-claim-canonical-reconciliation.js";
export {
  archiveClaim,
  archiveClaimIfUnchanged,
  buildClaim,
  inspectTaskClaim,
  inspectTaskClaimWithOwnerRun,
  listTaskClaimInspections,
  readActiveTaskClaim,
  readTaskClaimInspectionStore,
  taskClaimPath,
  writeClaim,
} from "./task-claim-files.js";
export {
  claimTask,
  continueTaskClaim,
  expireTaskClaim,
  markTaskClaimPendingDecomposition,
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
  skippedTaskClaimRecoveryPath,
  type TaskClaim,
  type TaskClaimCanonicalReconciliationInput,
  type TaskClaimInspection,
  type TaskClaimMutationInput,
  type TaskClaimRecoveryPath,
  type TaskClaimRecoveryStatus,
  type TaskClaimStatus,
  type TaskClaimTerminalResult,
  type TaskClaimWorkspaceInput,
} from "./task-claim-types.js";

export function compareQueueTaskCandidates(
  a: RepoTaskFullRecord,
  b: RepoTaskFullRecord,
): number {
  const stateRank = (task: RepoTaskFullRecord) => (task.state === "doing" ? 0 : 1);
  const byState = stateRank(a) - stateRank(b);
  if (byState !== 0) return byState;
  return compareAutonomyTasks(a, b);
}

export function listQueueTaskCandidates(
  projectDir: string,
  candidateStates = CLAIM_CANDIDATE_STATES,
): VerifiedRepoTaskFullRecord[] {
  const allTasks = listVerifiedFullRepoTasks(projectDir);
  const stateByTaskId = new Map(allTasks.map((task) => [task.id, task.state]));
  return allTasks
    .filter((task) => candidateStates.includes(task.state))
    .filter((task) =>
      task.dependsOn.every((dependency) => stateByTaskId.get(dependency) === "done"),
    )
    .sort(compareQueueTaskCandidates);
}

export function listClaimableQueueTaskCandidates(
  projectDir: string,
  now: Date = new Date(),
  candidateStates = CLAIM_CANDIDATE_STATES,
): VerifiedRepoTaskFullRecord[] {
  const blockedTaskIds = new Set(
    listTaskClaimInspections(projectDir, now)
      .filter((inspection) => !inspection.safeToRetry)
      .map((inspection) => inspection.claim.taskId),
  );
  return listQueueTaskCandidates(projectDir, candidateStates).filter(
    (task) => !blockedTaskIds.has(task.id),
  );
}

function assertTaskFileStillMatches(
  expected: VerifiedRepoTaskFullRecord,
  current: RepoTaskFileDescriptor,
): void {
  const left = expected.taskFile;
  const right = current;
  if (
    left.path !== right.path ||
    left.snapshot.dev !== right.snapshot.dev ||
    left.snapshot.ino !== right.snapshot.ino ||
    left.snapshot.size !== right.snapshot.size ||
    left.snapshot.mtimeMs !== right.snapshot.mtimeMs ||
    left.snapshot.ctimeMs !== right.snapshot.ctimeMs
  ) {
    throw new Error(
      `Cannot claim task ${expected.id}: verified task file changed during queue selection`,
    );
  }
}

export function claimNextQueueTask(input: ClaimNextQueueTaskInput): QueueTaskClaimResult {
  const now = input.now ?? new Date();
  const candidateStates = input.candidateStates ?? CLAIM_CANDIDATE_STATES;
  const candidates = listQueueTaskCandidates(input.projectDir, candidateStates);
  const skipped: ClaimTaskAttempt[] = [];

  for (const task of candidates) {
    const current = readVerifiedRepoTaskFile(
      input.projectDir,
      task.state,
      task.id,
    );
    if (current === null) {
      throw new Error(
        `Cannot claim task ${task.id}: verified task file disappeared during queue selection`,
      );
    }
    assertTaskFileStillMatches(task, current);
    const attempt = claimTask({
      ...input,
      taskId: task.id,
      taskState: task.state,
      taskFile: task.taskFile,
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
