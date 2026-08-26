import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  getRepoTaskQueueSnapshot,
  isThinDispatchableQueue,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { hasStrategicReadyCoverageGap } from "#modules/repo-tasks/task-queue-validation.js";
import {
  listStrategicBlockedAlternatives,
  type StrategicBlockedSummary,
} from "./exploration-rationale.js";

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
  strategicReadyCoverageGap: boolean;
  strategicBlockedAlternatives: StrategicBlockedSummary[];
};

export function inspectExplorerAssessment(input: {
  projectDir: string;
  lastExplorationAt: string | null;
}): ExplorerAssessment {
  const { projectDir, lastExplorationAt } = input;
  const worktree = getRepoWorktreeStatus(projectDir);
  const dirty = worktree.available && worktree.dirty;
  const queue = getRepoTaskQueueSnapshot(projectDir);
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
    strategicReadyCoverageGap: hasStrategicReadyCoverageGap(projectDir),
    strategicBlockedAlternatives: listStrategicBlockedAlternatives(projectDir),
  };
}

export const explorerAssessmentOperation = defineWorkflowBlockingOperation<
  { projectDir: string; lastExplorationAt: string | null },
  ExplorerAssessment
>(import.meta.url, "inspectExplorerAssessment");
