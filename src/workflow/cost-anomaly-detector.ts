import type { WorkflowRunStore } from "./run-store.js";

const MIN_HISTORY_RUNS = 3;
const HISTORY_LIMIT = 10;

export type CostAnomalyResult = {
  baselineCostUsd: number;
  historicalRunCount: number;
  text: string;
};

/**
 * Checks whether a completed run's cost is anomalously high relative to
 * the rolling average of recent successful runs for the same workflow.
 *
 * Returns a result if the anomaly fires, or null if the check is skipped
 * (too few history runs, zero baseline, or cost within threshold).
 */
export function detectCostAnomaly(
  store: WorkflowRunStore,
  workflow: string,
  runId: string,
  runCostUsd: number,
  threshold: number,
): CostAnomalyResult | null {
  const historical = store
    .listRuns({ workflow, limit: HISTORY_LIMIT + 1 })
    .filter(
      (r) =>
        r.id !== runId &&
        typeof r.totalCostUsd === "number" &&
        r.status !== "failed" &&
        r.status !== "interrupted",
    )
    .slice(0, HISTORY_LIMIT);

  if (historical.length < MIN_HISTORY_RUNS) return null;

  const baseline =
    historical.reduce((sum, r) => sum + (r.totalCostUsd ?? 0), 0) /
    historical.length;

  if (baseline <= 0 || runCostUsd <= threshold * baseline) return null;

  const text = [
    `Cost anomaly detected: *${workflow}*`,
    `Run: \`${runId}\``,
    `Cost: $${runCostUsd.toFixed(4)}`,
    `Baseline (${historical.length} runs): $${baseline.toFixed(4)}`,
    `Threshold: ${threshold}×`,
  ].join("\n");

  return { baselineCostUsd: baseline, historicalRunCount: historical.length, text };
}
