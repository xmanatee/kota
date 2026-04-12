import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";

const BASELINE_FILE = "cost-baseline.json";
const STALE_BASELINE_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_CONFIDENT_RUNS = 3;

type BaselineEntry = {
  avgCostUsd: number;
  runCount: number;
  updatedAt: string;
};

type BaselineFile = {
  version: 1;
  baselines: Record<string, BaselineEntry>;
};

export type WorkflowCostForecast = {
  workflow: string;
  baselineAvgCostUsd: number;
  sampleSize: number;
  updatedAt: string;
  stale: boolean;
  confidence: "high" | "low";
};

export function getWorkflowCostForecast(
  kotaDir: string,
  workflow: string,
): WorkflowCostForecast | null {
  const data = readOptionalJsonFile<BaselineFile>(join(kotaDir, BASELINE_FILE));
  if (!data || data.version !== 1) return null;
  const entry = data.baselines[workflow];
  if (!entry || typeof entry.avgCostUsd !== "number" || entry.avgCostUsd <= 0) return null;

  const stale = Date.now() - new Date(entry.updatedAt).getTime() > STALE_BASELINE_MS;
  const confidence =
    entry.runCount >= MIN_CONFIDENT_RUNS && !stale ? "high" : "low";

  return {
    workflow,
    baselineAvgCostUsd: entry.avgCostUsd,
    sampleSize: entry.runCount,
    updatedAt: entry.updatedAt,
    stale,
    confidence,
  };
}
