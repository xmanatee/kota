import { readdirSync } from "node:fs";
import { join } from "node:path";
import { validateWorkflowRunId } from "#core/workflow/run-io.js";
import { readWorkflowRunMetadataFile } from "#core/workflow/run-metadata.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";

declare const storedWorkflowRunDirectoryId: unique symbol;

export type StoredWorkflowRunDirectoryId = string & {
  readonly [storedWorkflowRunDirectoryId]: "stored-workflow-run-directory-id";
};

export type StoredWorkflowRun = WorkflowRunMetadata & {
  id: StoredWorkflowRunDirectoryId;
};

export type HistoryStats = {
  total: number;
  successes: number;
  failures: number;
  interrupted: number;
  successRate: number;
  totalCostUsd: number | null;
  avgCostUsd: number | null;
  measuredCostRuns: number;
  unavailableCostRuns: number;
  unknownCostRuns: number;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
};

export type StoredWorkflowRunFilter = {
  sinceMs?: number;
  untilMs?: number;
  workflow?: string;
  tag?: string;
  causedByRunId?: string;
};

const VALID_RUN_STATUSES = new Set([
  "running",
  "success",
  "failed",
  "interrupted",
  "completed-with-warnings",
]);

function isWorkflowRunMetadata(value: WorkflowRunMetadata | null): value is WorkflowRunMetadata {
  if (!value || typeof value !== "object") return false;
  return (
    typeof value.id === "string" &&
    typeof value.workflow === "string" &&
    typeof value.startedAt === "string" &&
    Number.isFinite(new Date(value.startedAt).getTime()) &&
    typeof value.status === "string" &&
    VALID_RUN_STATUSES.has(value.status)
  );
}

function storedWorkflowRunForDirectory(
  value: WorkflowRunMetadata | null,
  directoryName: string,
): StoredWorkflowRun | null {
  if (!isWorkflowRunMetadata(value)) return null;
  let validatedDirectoryName: string;
  try {
    validatedDirectoryName = validateWorkflowRunId(
      directoryName,
      "Stored workflow run directory",
    );
  } catch {
    return null;
  }
  if (value.id !== validatedDirectoryName) return null;
  return {
    ...value,
    id: validatedDirectoryName as StoredWorkflowRunDirectoryId,
  };
}

export function storedWorkflowRunDirectory(
  runsDir: string,
  run: Pick<StoredWorkflowRun, "id">,
): string {
  return join(runsDir, run.id);
}

export function loadRunsInWindow(
  runsDir: string,
  cutoffMs: number,
  untilMs = Number.POSITIVE_INFINITY,
): StoredWorkflowRun[] {
  return listStoredWorkflowRuns(runsDir, { sinceMs: cutoffMs, untilMs });
}

export function listStoredWorkflowRuns(
  runsDir: string,
  filter: StoredWorkflowRunFilter = {},
): StoredWorkflowRun[] {
  let dirs: string[];
  try {
    dirs = readdirSync(runsDir);
  } catch {
    return [];
  }
  const runs: StoredWorkflowRun[] = [];
  for (const dir of dirs) {
    const metadataPath = join(runsDir, dir, "metadata.json");
    const metadata = storedWorkflowRunForDirectory(
      readWorkflowRunMetadataFile(metadataPath),
      dir,
    );
    if (!metadata) continue;
    const startedAtMs = new Date(metadata.startedAt).getTime();
    if (filter.untilMs !== undefined && startedAtMs > filter.untilMs) continue;
    if (filter.sinceMs !== undefined && startedAtMs < filter.sinceMs) continue;
    if (filter.workflow !== undefined && metadata.workflow !== filter.workflow) continue;
    if (filter.tag !== undefined && !(metadata.tags ?? []).includes(filter.tag)) continue;
    if (filter.causedByRunId !== undefined && metadata.causedBy?.runId !== filter.causedByRunId) {
      continue;
    }
    runs.push(metadata);
  }
  return runs.sort((a, b) => {
    const byStartedAt = new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
    return byStartedAt !== 0 ? byStartedAt : b.id.localeCompare(a.id);
  });
}

export function computeHistoryStats(runs: WorkflowRunMetadata[]): HistoryStats {
  const finished = runs.filter((r) => r.status !== "running");
  const total = finished.length;
  const successes = finished.filter((r) => r.status === "success").length;
  const failures = finished.filter((r) => r.status === "failed").length;
  const interrupted = finished.filter((r) => r.status === "interrupted").length;
  const successRate = total > 0 ? (successes / total) * 100 : 0;
  const measuredCosts = finished.flatMap((run) =>
    run.usage?.cost.state === "complete" ? [run.usage.cost.usd] : []
  );
  const unavailableCostRuns = finished.filter(
    (run) => run.usage?.cost.state === "unavailable",
  ).length;
  const unknownCostRuns = finished.filter(
    (run) => run.steps.some((step) => step.type === "agent") &&
      run.usage?.cost.state !== "complete" &&
      run.usage?.cost.state !== "unavailable",
  ).length;
  const totalCostUsd = measuredCosts.length > 0
    ? measuredCosts.reduce((sum, cost) => sum + cost, 0)
    : null;
  const avgCostUsd = totalCostUsd === null ? null : totalCostUsd / measuredCosts.length;
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
    measuredCostRuns: measuredCosts.length,
    unavailableCostRuns,
    unknownCostRuns,
    avgDurationMs,
    p95DurationMs,
  };
}
