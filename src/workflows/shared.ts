import { execSync } from "node:child_process";
import type {
  WorkflowPredicate,
  WorkflowRunMetadata,
  WorkflowRuntimeState,
} from "../workflow/run-types.js";
import { loadRunsInWindow } from "../workflow-history.js";

export const READY_TASK_TARGET = 2;
export const BACKLOG_TASK_TARGET = 4;

export type RunSummary = {
  id: string;
  workflow: string;
  status: string;
  durationMs?: number;
  totalCostUsd?: number;
};

export function summarizeRun(metadata: WorkflowRunMetadata): RunSummary {
  return {
    id: metadata.id,
    workflow: metadata.workflow,
    status: metadata.status,
    ...(metadata.durationMs != null ? { durationMs: metadata.durationMs } : {}),
    ...(metadata.totalCostUsd != null ? { totalCostUsd: metadata.totalCostUsd } : {}),
  };
}

export function loadRecentCommits(projectDir: string): string[] {
  try {
    const output = execSync("git log --oneline -10", {
      cwd: projectDir,
      encoding: "utf-8",
    });
    return output.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export function loadRecentlyAttemptedTaskIds(projectDir: string): string[] {
  try {
    const output = execSync(
      'git log --grep="^Builder:" --name-only --format="" -- tasks/done/ tasks/doing/',
      { cwd: projectDir, encoding: "utf-8" },
    );
    const taskIds: string[] = [];
    for (const line of output.split("\n")) {
      const match = line.trim().match(/^tasks\/(?:done|doing)\/(task-[^/]+)\.md$/);
      if (match && !taskIds.includes(match[1])) {
        taskIds.push(match[1]);
        if (taskIds.length >= 10) break;
      }
    }
    return taskIds;
  } catch {
    return [];
  }
}

export function loadRecentRuns(runsDir: string): RunSummary[] {
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  return loadRunsInWindow(runsDir, cutoffMs).slice(0, 20).map(summarizeRun);
}

export function computeCostByWorkflow(runs: RunSummary[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const run of runs) {
    if (run.totalCostUsd != null) {
      result[run.workflow] = (result[run.workflow] ?? 0) + run.totalCostUsd;
    }
  }
  return result;
}

export function loadChangedFiles(projectDir: string, since?: string): string[] {
  try {
    const output = since
      ? execSync(`git log --name-only --format="" --after=${since}`, {
          cwd: projectDir,
          encoding: "utf-8",
        })
      : execSync("git diff --name-only HEAD~1 HEAD", {
          cwd: projectDir,
          encoding: "utf-8",
        });
    return [...new Set(output.trim().split("\n").filter(Boolean))];
  } catch {
    return [];
  }
}

export function buildRuntimeState(state: WorkflowRuntimeState): {
  completedRuns: number;
  workflows: Record<string, { lastStatus?: string; lastRunId?: string }>;
} {
  return {
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
}

export function stepSucceeded(stepId: string): WorkflowPredicate {
  return ({ stepResults }) => stepResults[stepId]?.status === "success";
}
