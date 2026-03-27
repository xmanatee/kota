import { join } from "node:path";
import { getRepoTaskQueueSnapshot } from "../../repo-tasks.js";
import type { WorkflowStepContext } from "../../workflow/run-types.js";
import {
  buildRuntimeState,
  computeCostByWorkflow,
  loadRecentCommits,
  loadRecentlyAttemptedTaskIds,
  loadRecentRuns,
  type RunSummary,
} from "../shared.js";

export type { RunSummary };

export type BuilderContext = {
  taskCounts: Record<string, number>;
  recentRuns: RunSummary[];
  recentCommits: string[];
  recentlyAttemptedTaskIds: string[];
  costByWorkflow: Record<string, number>;
  runtimeState: {
    completedRuns: number;
    workflows: Record<string, { lastStatus?: string; lastRunId?: string }>;
  };
};

export function gatherBuilderContext(ctx: WorkflowStepContext): BuilderContext {
  const { projectDir, readRuntimeState } = ctx;
  const runsDir = join(projectDir, ".kota", "runs");

  const queue = getRepoTaskQueueSnapshot(projectDir);
  const taskCounts = queue.counts;

  const recentRuns = loadRecentRuns(runsDir);
  const recentCommits = loadRecentCommits(projectDir);
  const recentlyAttemptedTaskIds = loadRecentlyAttemptedTaskIds(projectDir);
  const costByWorkflow = computeCostByWorkflow(recentRuns);
  const runtimeState = buildRuntimeState(readRuntimeState());

  return { taskCounts, recentRuns, recentCommits, recentlyAttemptedTaskIds, costByWorkflow, runtimeState };
}
