import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  getClaimAwareRepoTaskQueueSnapshot,
  isThinClaimAwareDispatchableQueue,
} from "#modules/autonomy/queue-availability.js";
import { hasClaimAwareStrategicReadyCoverageGapForQueue } from "#modules/autonomy/strategic-ready-coverage.js";
import {
  listStrategicBlockedAlternatives,
  type StrategicBlockedSummary,
} from "./exploration-rationale.js";
import { readLastExplorationAt } from "./explorer-state.js";

export const EXPLORATION_REFRESH_MS = 30 * 60 * 1000;

export type ExplorerAssessment = {
  counts: ReturnType<typeof getClaimAwareRepoTaskQueueSnapshot>["counts"];
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
}): ExplorerAssessment {
  const { projectDir } = input;
  const lastExplorationAt = readLastExplorationAt(projectDir);
  const worktree = getRepoWorktreeStatus(projectDir);
  const dirty = worktree.available && worktree.dirty;
  const queue = getClaimAwareRepoTaskQueueSnapshot(projectDir);
  const explorationRefreshDue = !lastExplorationAt ||
    Date.now() - new Date(lastExplorationAt).getTime() >= EXPLORATION_REFRESH_MS;
  const queueNeedsExploration = !queue.hasDispatchableWork ||
    isThinClaimAwareDispatchableQueue(queue);
  const locallyBlocked = queue.claimBlockedTasks.length > 0 ||
    queue.dependencyBlockedTasks.length > 0;
  return {
    ...queue,
    dirty,
    needsAttention:
      !dirty && !locallyBlocked && queueNeedsExploration && explorationRefreshDue,
    explorationRefreshDue,
    strategicReadyCoverageGap: hasClaimAwareStrategicReadyCoverageGapForQueue(
      projectDir,
      queue,
    ),
    strategicBlockedAlternatives: listStrategicBlockedAlternatives(projectDir),
  };
}

export const explorerAssessmentOperation = defineWorkflowBlockingOperation<
  { projectDir: string },
  ExplorerAssessment
>(import.meta.url, "inspectExplorerAssessment");
