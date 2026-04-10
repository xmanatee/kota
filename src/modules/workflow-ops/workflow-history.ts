import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readOptionalJsonFile } from "../../json-file.js";
import type { WorkflowRunMetadata } from "../../core/workflow/run-types.js";

export type HistoryStats = {
  total: number;
  successes: number;
  failures: number;
  interrupted: number;
  successRate: number;
  totalCostUsd: number;
  avgCostUsd: number;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
};

export function loadRunsInWindow(runsDir: string, cutoffMs: number): WorkflowRunMetadata[] {
  let dirs: string[];
  try {
    dirs = readdirSync(runsDir).sort().reverse();
  } catch {
    return [];
  }
  const runs: WorkflowRunMetadata[] = [];
  for (const dir of dirs) {
    const metadataPath = join(runsDir, dir, "metadata.json");
    const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);
    if (!metadata) continue;
    if (new Date(metadata.startedAt).getTime() < cutoffMs) break;
    runs.push(metadata);
  }
  return runs;
}

export function computeHistoryStats(runs: WorkflowRunMetadata[]): HistoryStats {
  const finished = runs.filter((r) => r.status !== "running");
  const total = finished.length;
  const successes = finished.filter((r) => r.status === "success").length;
  const failures = finished.filter((r) => r.status === "failed").length;
  const interrupted = finished.filter((r) => r.status === "interrupted").length;
  const successRate = total > 0 ? (successes / total) * 100 : 0;
  const totalCostUsd = finished.reduce((sum, r) => sum + (r.totalCostUsd ?? 0), 0);
  const avgCostUsd = total > 0 ? totalCostUsd / total : 0;
  const durations = finished
    .map((r) => r.durationMs)
    .filter((d): d is number => d != null)
    .sort((a, b) => a - b);
  const avgDurationMs =
    durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null;
  const p95DurationMs =
    durations.length > 0
      ? durations[Math.ceil(0.95 * durations.length) - 1]
      : null;
  return {
    total,
    successes,
    failures,
    interrupted,
    successRate,
    totalCostUsd,
    avgCostUsd,
    avgDurationMs,
    p95DurationMs,
  };
}
