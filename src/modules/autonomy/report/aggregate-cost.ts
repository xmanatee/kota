import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { CostBreakdown, WorkflowCostRow } from "./aggregate-types.js";

export function buildCostBreakdown(
  runs: WorkflowRunMetadata[],
): CostBreakdown {
  const finished = runs.filter(
    (r) => r.status !== "running" && r.steps.some((step) => step.type === "agent"),
  );
  let totalCostUsd = 0;
  let measuredRuns = 0;
  let unavailableRuns = 0;
  let unknownRuns = 0;
  const groups = new Map<string, {
    runs: number;
    measuredRuns: number;
    unavailableRuns: number;
    unknownRuns: number;
    totalCostUsd: number;
  }>();
  for (const run of finished) {
    const existing = groups.get(run.workflow) ?? {
      runs: 0,
      measuredRuns: 0,
      unavailableRuns: 0,
      unknownRuns: 0,
      totalCostUsd: 0,
    };
    existing.runs += 1;
    if (run.usage?.cost.state === "complete") {
      existing.measuredRuns += 1;
      existing.totalCostUsd += run.usage.cost.usd;
      measuredRuns += 1;
      totalCostUsd += run.usage.cost.usd;
    } else if (run.usage?.cost.state === "unavailable") {
      existing.unavailableRuns += 1;
      unavailableRuns += 1;
    } else {
      existing.unknownRuns += 1;
      unknownRuns += 1;
    }
    groups.set(run.workflow, existing);
  }
  const byWorkflow: WorkflowCostRow[] = [...groups.entries()]
    .map(([workflow, agg]) => ({
      workflow,
      finishedRuns: agg.runs,
      measuredRuns: agg.measuredRuns,
      unavailableRuns: agg.unavailableRuns,
      unknownRuns: agg.unknownRuns,
      totalCostUsd: agg.measuredRuns > 0 ? agg.totalCostUsd : null,
      averageMeasuredCostUsd:
        agg.measuredRuns > 0 ? agg.totalCostUsd / agg.measuredRuns : null,
    }))
    .sort((a, b) => (b.totalCostUsd ?? -1) - (a.totalCostUsd ?? -1));
  return {
    totalCostUsd: measuredRuns > 0 ? totalCostUsd : null,
    finishedRuns: finished.length,
    measuredRuns,
    unavailableRuns,
    unknownRuns,
    averageMeasuredCostUsd:
      measuredRuns > 0 ? totalCostUsd / measuredRuns : null,
    byWorkflow,
  };
}
