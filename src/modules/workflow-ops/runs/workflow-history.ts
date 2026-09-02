import { join } from "node:path";
import {
  enumerateWorkflowRunMetadata,
  type StoredWorkflowRunDirectoryId,
  type StoredWorkflowRunMetadata,
  type WorkflowRunMetadataEnumeration,
} from "#core/workflow/run-metadata.js";
import {
  enumerateWorkflowRunMetadataWithDurableAuthority,
} from "#core/workflow/run-operational-projection.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";

export type { StoredWorkflowRunDirectoryId };
export type StoredWorkflowRun = StoredWorkflowRunMetadata;

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

export type WorkflowRunAuthorityProjection = {
  authorityCriticalRunIds: ReadonlySet<string>;
  operationallyActiveRunIds: ReadonlySet<string>;
  terminalRunIds: ReadonlySet<string>;
};

export type WorkflowRunDurableAuthority =
  | { stateDir: string; scopeRoot: string }
  | WorkflowRunAuthorityProjection;

/** Consume the complete durable authority projection exposed by workflow status. */
export function requireWorkflowRunDurableAuthority(
  authorityCriticalRunIds: readonly string[] | undefined,
  operationallyActiveRunIds: readonly string[] | undefined,
  terminalRunIds: readonly string[] | undefined,
): WorkflowRunAuthorityProjection {
  if (
    authorityCriticalRunIds === undefined ||
    operationallyActiveRunIds === undefined ||
    terminalRunIds === undefined
  ) {
    throw new Error(
      "Workflow run inspection requires the canonical durable run authority from workflow status",
    );
  }
  return {
    authorityCriticalRunIds: new Set(authorityCriticalRunIds),
    operationallyActiveRunIds: new Set(operationallyActiveRunIds),
    terminalRunIds: new Set(terminalRunIds),
  };
}

/** Build an artifact reader whose metadata decisions use canonical authority. */
export function workflowRunStoreWithDurableAuthority(
  scopeRoot: string,
  authority: WorkflowRunAuthorityProjection,
): WorkflowRunStore {
  return new WorkflowRunStore(scopeRoot, {
    authorityCriticalRunIds: () => authority.authorityCriticalRunIds,
    operationallyActiveRunIds: () => authority.operationallyActiveRunIds,
    terminalRunIds: () => authority.terminalRunIds,
  });
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
  authority: WorkflowRunDurableAuthority,
  untilMs = Number.POSITIVE_INFINITY,
): StoredWorkflowRun[] {
  return listStoredWorkflowRuns(
    runsDir,
    { sinceMs: cutoffMs, untilMs },
    authority,
  );
}

export function listStoredWorkflowRuns(
  runsDir: string,
  filter: StoredWorkflowRunFilter,
  authority: WorkflowRunDurableAuthority,
): StoredWorkflowRun[] {
  const runs: StoredWorkflowRun[] = [];
  let enumeration: WorkflowRunMetadataEnumeration;
  if ("authorityCriticalRunIds" in authority) {
    enumeration = enumerateWorkflowRunMetadata(runsDir, {
      authorityCriticalRunIds: authority.authorityCriticalRunIds,
      operationallyActiveRunIds: authority.operationallyActiveRunIds,
      terminalRunIds: authority.terminalRunIds,
    });
  } else {
    enumeration = enumerateWorkflowRunMetadataWithDurableAuthority({
      runsDir,
      stateDir: authority.stateDir,
      scopeRoot: authority.scopeRoot,
    });
  }
  for (const metadata of enumeration.runs) {
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
