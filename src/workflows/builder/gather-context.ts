import { execSync } from "node:child_process";
import { join } from "node:path";
import { getRepoTaskQueueSnapshot } from "../../repo-tasks.js";
import type { WorkflowRunMetadata, WorkflowStepContext } from "../../workflow/types.js";
import { loadRunsInWindow } from "../../workflow-history.js";

export type RunSummary = {
  id: string;
  workflow: string;
  status: string;
  durationMs?: number;
  totalCostUsd?: number;
};

export type BuilderContext = {
  taskCounts: Record<string, number>;
  recentRuns: RunSummary[];
  recentCommits: string[];
  runtimeState: {
    completedRuns: number;
    workflows: Record<string, { lastStatus?: string; lastRunId?: string }>;
  };
};

function summarizeRun(metadata: WorkflowRunMetadata): RunSummary {
  return {
    id: metadata.id,
    workflow: metadata.workflow,
    status: metadata.status,
    ...(metadata.durationMs != null ? { durationMs: metadata.durationMs } : {}),
    ...(metadata.totalCostUsd != null ? { totalCostUsd: metadata.totalCostUsd } : {}),
  };
}

function loadRecentCommits(projectDir: string): string[] {
  try {
    const output = execSync("git log --oneline -10", {
      cwd: projectDir,
      encoding: "utf-8",
    });
    return output
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function gatherBuilderContext(ctx: WorkflowStepContext): BuilderContext {
  const { projectDir, readRuntimeState } = ctx;
  const runsDir = join(projectDir, ".kota", "runs");

  const queue = getRepoTaskQueueSnapshot(projectDir);
  const taskCounts = queue.counts;

  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  const recentRuns = loadRunsInWindow(runsDir, cutoffMs).slice(0, 20).map(summarizeRun);
  const recentCommits = loadRecentCommits(projectDir);

  const state = readRuntimeState();
  const runtimeState = {
    completedRuns: state.completedRuns,
    workflows: Object.fromEntries(
      Object.entries(state.workflows).map(([name, entry]) => [
        name,
        {
          ...(entry.lastStatus ? { lastStatus: entry.lastStatus } : {}),
          ...(entry.lastRunId ? { lastRunId: entry.lastRunId } : {}),
        },
      ]),
    ),
  };

  return { taskCounts, recentRuns, recentCommits, runtimeState };
}
