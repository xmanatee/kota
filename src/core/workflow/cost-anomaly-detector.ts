import { join } from "node:path";
import { readOptionalJsonFile, writeJsonFileAtomic } from "#root/json-file.js";
import type { WorkflowRunStore } from "./run-store.js";

const MIN_HISTORY_RUNS = 3;
const HISTORY_LIMIT = 10;
const STALE_BASELINE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const BASELINE_FILE = "cost-baseline.json";

export type CostAnomalyResult = {
  baselineCostUsd: number;
  historicalRunCount: number;
  text: string;
};

type BaselineEntry = {
  avgCostUsd: number;
  runCount: number;
  updatedAt: string;
};

type BaselineFile = {
  version: 1;
  baselines: Record<string, BaselineEntry>;
};

function loadWorkflowBaseline(
  kotaDir: string,
  workflow: string,
): { avgCostUsd: number; runCount: number } | null {
  try {
    const data = readOptionalJsonFile<BaselineFile>(join(kotaDir, BASELINE_FILE));
    if (!data || data.version !== 1) return null;
    const entry = data.baselines[workflow];
    if (!entry || typeof entry.avgCostUsd !== "number" || entry.avgCostUsd <= 0) return null;
    if (Date.now() - new Date(entry.updatedAt).getTime() > STALE_BASELINE_MS) return null;
    return { avgCostUsd: entry.avgCostUsd, runCount: entry.runCount };
  } catch {
    return null;
  }
}

function saveWorkflowBaseline(
  kotaDir: string,
  workflow: string,
  avgCostUsd: number,
  runCount: number,
): void {
  try {
    const path = join(kotaDir, BASELINE_FILE);
    const existing = readOptionalJsonFile<BaselineFile>(path);
    const baselines = existing?.version === 1 ? { ...existing.baselines } : {};
    baselines[workflow] = { avgCostUsd, runCount, updatedAt: new Date().toISOString() };
    writeJsonFileAtomic(path, { version: 1, baselines });
  } catch {
    // Persistence failure must not break anomaly detection
  }
}

/**
 * Checks whether a completed run's cost is anomalously high relative to
 * the rolling average of recent successful runs for the same workflow.
 *
 * When kotaDir is provided, the computed baseline is persisted to
 * `.kota/cost-baseline.json` so it survives daemon restarts. If the run
 * store has fewer than MIN_HISTORY_RUNS, the persisted baseline is used
 * as a fallback (unless it is stale, i.e. older than 30 days).
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
  kotaDir?: string,
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

  let baselineCostUsd: number;
  let historicalRunCount: number;

  if (historical.length >= MIN_HISTORY_RUNS) {
    baselineCostUsd =
      historical.reduce((sum, r) => sum + (r.totalCostUsd ?? 0), 0) / historical.length;
    historicalRunCount = historical.length;
    if (kotaDir && baselineCostUsd > 0) {
      saveWorkflowBaseline(kotaDir, workflow, baselineCostUsd, historicalRunCount);
    }
  } else if (kotaDir) {
    const persisted = loadWorkflowBaseline(kotaDir, workflow);
    if (!persisted) return null;
    baselineCostUsd = persisted.avgCostUsd;
    historicalRunCount = persisted.runCount;
  } else {
    return null;
  }

  if (baselineCostUsd <= 0 || runCostUsd <= threshold * baselineCostUsd) return null;

  const text = [
    `Cost anomaly detected: *${workflow}*`,
    `Run: \`${runId}\``,
    `Cost: $${runCostUsd.toFixed(4)}`,
    `Baseline (${historicalRunCount} runs): $${baselineCostUsd.toFixed(4)}`,
    `Threshold: ${threshold}×`,
  ].join("\n");

  return { baselineCostUsd, historicalRunCount, text };
}
