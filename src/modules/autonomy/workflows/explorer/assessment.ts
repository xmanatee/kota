import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  getRepoTaskQueueSnapshot,
  isThinDispatchableQueue,
} from "#modules/repo-tasks/repo-tasks-domain.js";

export const EXPLORATION_REFRESH_MS = 30 * 60 * 1000;

export type ExplorerAssessment = {
  counts: ReturnType<typeof getRepoTaskQueueSnapshot>["counts"];
  inboxCount: number;
  openCount: number;
  pullableCount: number;
  actionableCount: number;
  promotableBacklogCount: number;
  dispatchableCount: number;
  hasDispatchableWork: boolean;
  dirty: boolean;
  needsAttention: boolean;
  explorationRefreshDue: boolean;
};

export function inspectExplorerAssessment(input: {
  workspaceRoot: string;
  lastExplorationAt: string | null;
}): ExplorerAssessment {
  const { workspaceRoot, lastExplorationAt } = input;
  const worktree = getRepoWorktreeStatus(workspaceRoot);
  const dirty = worktree.available && worktree.dirty;
  const queue = getRepoTaskQueueSnapshot(workspaceRoot);
  const explorationRefreshDue = !lastExplorationAt ||
    Date.now() - new Date(lastExplorationAt).getTime() >= EXPLORATION_REFRESH_MS;
  const queueNeedsExploration = !queue.hasDispatchableWork ||
    isThinDispatchableQueue(queue);
  const locallyBlocked = queue.dependencyBlockedTasks.length > 0;
  return {
    ...queue,
    dirty,
    needsAttention:
      !dirty && !locallyBlocked && queueNeedsExploration && explorationRefreshDue,
    explorationRefreshDue,
  };
}

export const explorerAssessmentOperation = defineWorkflowBlockingOperation<
  { workspaceRoot: string; lastExplorationAt: string | null },
  ExplorerAssessment
>(import.meta.url, "inspectExplorerAssessment");
