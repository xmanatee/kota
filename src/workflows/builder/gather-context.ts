import { join } from "node:path";
import { getRepoTaskQueueSnapshot } from "../../repo-tasks.js";
import type { WorkflowStepContext } from "../../workflow/types.js";
import { loadRunsInWindow } from "../../workflow-history.js";
import { buildRuntimeState, loadRecentCommits, type RunSummary, summarizeRun } from "../shared.js";

export type { RunSummary };

export type BuilderContext = {
  taskCounts: Record<string, number>;
  recentRuns: RunSummary[];
  recentCommits: string[];
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

  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  const recentRuns = loadRunsInWindow(runsDir, cutoffMs).slice(0, 20).map(summarizeRun);
  const recentCommits = loadRecentCommits(projectDir);
  const runtimeState = buildRuntimeState(readRuntimeState());

  return { taskCounts, recentRuns, recentCommits, runtimeState };
}
