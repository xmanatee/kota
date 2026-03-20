import { join } from "node:path";
import type { WorkflowStepContext } from "../../workflow/types.js";
import { loadRunsInWindow } from "../../workflow-history.js";
import { buildRuntimeState, loadRecentCommits, type RunSummary, summarizeRun } from "../shared.js";

export type { RunSummary };

export type ExplorerContext = {
  needsAttention: boolean;
  taskCounts: Record<string, number>;
  recentRuns: RunSummary[];
  recentCommits: string[];
  runtimeState: {
    completedRuns: number;
    workflows: Record<string, { lastStatus?: string; lastRunId?: string }>;
  };
};

export function gatherExplorerContext(ctx: WorkflowStepContext): ExplorerContext {
  const { projectDir, previousOutput, readRuntimeState } = ctx;
  const runsDir = join(projectDir, ".kota", "runs");

  const needsAttention = Boolean(
    previousOutput &&
      typeof previousOutput === "object" &&
      "needsAttention" in previousOutput &&
      (previousOutput as Record<string, unknown>).needsAttention === true,
  );
  const taskCounts =
    previousOutput &&
    typeof previousOutput === "object" &&
    "counts" in previousOutput
      ? ((previousOutput as Record<string, unknown>).counts as Record<string, number>)
      : {};

  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  const recentRuns = loadRunsInWindow(runsDir, cutoffMs).slice(0, 20).map(summarizeRun);
  const recentCommits = loadRecentCommits(projectDir);
  const runtimeState = buildRuntimeState(readRuntimeState());

  return { needsAttention, taskCounts, recentRuns, recentCommits, runtimeState };
}
