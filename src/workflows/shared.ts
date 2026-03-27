import type {
  WorkflowPredicate,
  WorkflowRunMetadata,
} from "../workflow/run-types.js";
import { loadRunsInWindow } from "../workflow-history.js";

export const READY_TASK_TARGET = 3;
export const BACKLOG_TASK_TARGET = 6;

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

export function stepSucceeded(stepId: string): WorkflowPredicate {
  return ({ stepResults }) => stepResults[stepId]?.status === "success";
}
