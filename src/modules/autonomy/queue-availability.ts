import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  getRepoTaskQueueSnapshot,
  listFullRepoTasks,
  type RepoTaskFullRecord,
  type RepoTaskQueueSnapshot,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  workflowStateRecoveryListCommand,
  workflowStateRecoveryResolveCommand,
} from "#modules/workflow-ops/state-recovery-command.js";
import {
  listTaskClaimInspections,
  skippedTaskClaimRecoveryPath,
  type TaskClaimInspection,
  type TaskClaimRecoveryPath,
  type TaskClaimRecoveryStatus,
  type TaskClaimStatus,
} from "./task-claims.js";

export type RepoTaskClaimBlock = {
  id: string;
  title: string;
  state: "ready" | "doing";
  claimStatus: TaskClaimStatus;
  recoveryStatus: TaskClaimRecoveryStatus;
  recoveryPath: TaskClaimRecoveryPath;
  owner: string;
  runId: string;
  workflowId: string;
  evidence: string | null;
  recoveryCommand: string;
  resolveCommand: string;
};

export type ClaimAwareRepoTaskQueueSnapshot = RepoTaskQueueSnapshot & {
  claimBlockedTasks: RepoTaskClaimBlock[];
};

export type ClaimAwareRepoTaskQueueSnapshotInput = {
  projectDir: string;
  nowIso?: string;
};

function listClaimBlockedTasks(
  projectDir: string,
  snapshot: RepoTaskQueueSnapshot,
  claimInspections: readonly TaskClaimInspection[],
): RepoTaskClaimBlock[] {
  if (claimInspections.length === 0) return [];
  const dependencyBlockedActionableIds = new Set(
    snapshot.dependencyBlockedTasks
      .filter((wait) => wait.state === "ready" || wait.state === "doing")
      .map((wait) => wait.id),
  );
  const taskById = new Map<string, RepoTaskFullRecord>(
    listFullRepoTasks(projectDir, ["ready", "doing"]).map((task) => [task.id, task]),
  );
  const blocked: RepoTaskClaimBlock[] = [];

  for (const inspection of claimInspections) {
    if (inspection.safeToRetry) continue;
    if (dependencyBlockedActionableIds.has(inspection.claim.taskId)) continue;
    const task = taskById.get(inspection.claim.taskId);
    if (!task || (task.state !== "ready" && task.state !== "doing")) continue;
    blocked.push({
      id: task.id,
      title: task.title,
      state: task.state,
      claimStatus: inspection.claim.status,
      recoveryStatus: inspection.recoveryStatus,
      recoveryPath: skippedTaskClaimRecoveryPath(inspection.recoveryStatus),
      owner: inspection.claim.owner,
      runId: inspection.claim.runId,
      workflowId: inspection.claim.workflowId,
      evidence: inspection.claim.evidence,
      recoveryCommand: workflowStateRecoveryListCommand(),
      resolveCommand: workflowStateRecoveryResolveCommand(task.id),
    });
  }

  return blocked.sort((a, b) => a.id.localeCompare(b.id));
}

export function getClaimAwareRepoTaskQueueSnapshot(
  projectDir: string,
  now: Date = new Date(),
): ClaimAwareRepoTaskQueueSnapshot {
  const snapshot = getRepoTaskQueueSnapshot(projectDir);
  const claimBlockedTasks = listClaimBlockedTasks(
    projectDir,
    snapshot,
    listTaskClaimInspections(projectDir, now),
  );
  const actionableCount = Math.max(
    0,
    snapshot.actionableCount - claimBlockedTasks.length,
  );
  const dispatchableCount =
    snapshot.dispatchableCount - snapshot.actionableCount + actionableCount;

  return {
    ...snapshot,
    pullableCount: Math.max(
      0,
      snapshot.pullableCount - claimBlockedTasks.length,
    ),
    actionableCount,
    dispatchableCount,
    hasDispatchableWork: dispatchableCount > 0,
    claimBlockedTasks,
  };
}

export function inspectClaimAwareRepoTaskQueueSnapshot(
  input: ClaimAwareRepoTaskQueueSnapshotInput,
): ClaimAwareRepoTaskQueueSnapshot {
  return getClaimAwareRepoTaskQueueSnapshot(
    input.projectDir,
    input.nowIso === undefined ? new Date() : new Date(input.nowIso),
  );
}

export const claimAwareRepoTaskQueueSnapshotOperation =
  defineWorkflowBlockingOperation<
    ClaimAwareRepoTaskQueueSnapshotInput,
    ClaimAwareRepoTaskQueueSnapshot
  >(import.meta.url, "inspectClaimAwareRepoTaskQueueSnapshot");

export function isThinClaimAwareDispatchableQueue(
  snapshot: ClaimAwareRepoTaskQueueSnapshot,
  promotableBacklogCount = snapshot.promotableBacklogCount,
): boolean {
  const dispatchableTailCount = snapshot.actionableCount + promotableBacklogCount;
  return (
    snapshot.inboxCount === 0 &&
    dispatchableTailCount <= 2 &&
    dispatchableTailCount > 0
  );
}
