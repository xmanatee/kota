import { join } from "node:path";
import type { WorkflowStepContext } from "../../workflow/types.js";
import { buildRuntimeState, computeCostByWorkflow, loadRecentCommits, loadRecentRuns, type RunSummary } from "../shared.js";

export type { RunSummary };

export type ExplorerContext = {
  needsAttention: boolean;
  taskCounts: Record<string, number>;
  recentRuns: RunSummary[];
  recentCommits: string[];
  costByWorkflow: Record<string, number>;
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

  const recentRuns = loadRecentRuns(runsDir);
  const recentCommits = loadRecentCommits(projectDir);
  const costByWorkflow = computeCostByWorkflow(recentRuns);
  const runtimeState = buildRuntimeState(readRuntimeState());

  return { needsAttention, taskCounts, recentRuns, recentCommits, costByWorkflow, runtimeState };
}
