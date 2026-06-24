import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { CostBreakdown, WorkflowCostRow } from "./aggregate-types.js";

export function buildCostBreakdown(
  runs: WorkflowRunMetadata[],
): CostBreakdown {
  const finished = runs.filter(
    (r) => r.status !== "running" && r.totalCostUsd !== undefined,
  );
  const totalCostUsd = finished.reduce(
    (sum, r) => sum + (r.totalCostUsd ?? 0),
    0,
  );
  const groups = new Map<string, { runs: number; totalCostUsd: number }>();
  for (const run of finished) {
    const existing = groups.get(run.workflow) ?? { runs: 0, totalCostUsd: 0 };
    existing.runs += 1;
    existing.totalCostUsd += run.totalCostUsd ?? 0;
    groups.set(run.workflow, existing);
  }
  const byWorkflow: WorkflowCostRow[] = [...groups.entries()]
    .map(([workflow, agg]) => ({
      workflow,
      finishedRuns: agg.runs,
      totalCostUsd: agg.totalCostUsd,
      averageCostUsd: agg.runs > 0 ? agg.totalCostUsd / agg.runs : 0,
    }))
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  return {
    totalCostUsd,
    finishedRuns: finished.length,
    averagePerFinishedRun:
      finished.length > 0 ? totalCostUsd / finished.length : 0,
    byWorkflow,
  };
}
