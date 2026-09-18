import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { assessAutonomyQueue } from "#modules/autonomy/queue-policy.js";
import { inspectRepoWorkSupply, type RepoWorkSupply } from "#modules/repo-tasks/work-supply.js";

export const EXPLORATION_REFRESH_MS = 30 * 60 * 1000;

export type ExplorerAssessment = RepoWorkSupply & {
  needsAttention: boolean;
  explorationRefreshDue: boolean;
};

export function inspectExplorerAssessment(input: {
  workspaceRoot: string;
  scopeRoot: string;
  stateDir: string;
  capacity: number;
  lastExplorationAt: string | null;
}): ExplorerAssessment {
  const { lastExplorationAt } = input;
  const queue = inspectRepoWorkSupply(input);
  const explorationRefreshDue = !lastExplorationAt ||
    Date.now() - new Date(lastExplorationAt).getTime() >= EXPLORATION_REFRESH_MS;
  const { explorationEligible } = assessAutonomyQueue(queue);
  return {
    ...queue,
    needsAttention: explorationEligible && explorationRefreshDue,
    explorationRefreshDue,
  };
}

export const explorerAssessmentOperation = defineWorkflowBlockingOperation<
  { workspaceRoot: string; scopeRoot: string; stateDir: string; capacity: number; lastExplorationAt: string | null },
  ExplorerAssessment
>(import.meta.url, "inspectExplorerAssessment");
