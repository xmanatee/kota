import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { readAutonomyRunDeliveryEvidence } from "#modules/autonomy/run-delivery-evidence.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import { normalizePriority } from "./aggregate-queue.js";
import type {
  BuilderBreakdown,
  BuilderClosure,
  ReportPriority,
} from "./aggregate-types.js";

export function buildBuilderBreakdown(
  runs: WorkflowRunMetadata[],
  taskById: Map<string, RepoTaskFullRecord>,
  runsDir: string,
): BuilderBreakdown {
  const closures: BuilderClosure[] = [];
  let unresolvedClosures = 0;
  for (const run of runs) {
    if (run.workflow !== "builder") continue;
    if (run.status !== "success" && run.status !== "completed-with-warnings") {
      continue;
    }
    const delivery = readAutonomyRunDeliveryEvidence(runsDir, run);
    if (!delivery?.taskId) {
      unresolvedClosures += 1;
      continue;
    }
    const task = taskById.get(delivery.taskId);
    if (!task) {
      unresolvedClosures += 1;
      continue;
    }
    closures.push({
      runId: run.id,
      taskId: delivery.taskId,
      taskTitle: delivery.taskTitle ?? task.title,
      priority: normalizePriority(task.priority),
      cost: delivery.cost,
      durationMs: run.durationMs ?? null,
    });
  }

  const byPriority = sortPriorityClosureRows(
    aggregateClosureCosts(closures, (c) => c.priority),
  ).map(({ key: priority, ...row }) => ({ priority, ...row }));

  return {
    totalCommittedRuns: closures.length,
    unresolvedClosures,
    byPriority,
    closures,
  };
}

type BuilderCostGroup<TKey extends string> = {
  key: TKey;
  commits: number;
  measuredCostRuns: number;
  unavailableCostRuns: number;
  unknownCostRuns: number;
  totalCostUsd: number | null;
};

function aggregateClosureCosts<TKey extends string>(
  closures: BuilderClosure[],
  keyFn: (c: BuilderClosure) => TKey,
): BuilderCostGroup<TKey>[] {
  const groups = new Map<TKey, {
    commits: number;
    measuredCostRuns: number;
    unavailableCostRuns: number;
    unknownCostRuns: number;
    measuredCostUsd: number;
  }>();
  for (const c of closures) {
    const key = keyFn(c);
    const existing = groups.get(key) ?? {
      commits: 0,
      measuredCostRuns: 0,
      unavailableCostRuns: 0,
      unknownCostRuns: 0,
      measuredCostUsd: 0,
    };
    existing.commits += 1;
    if (c.cost.state === "complete") {
      existing.measuredCostRuns += 1;
      existing.measuredCostUsd += c.cost.usd;
    } else if (c.cost.state === "unavailable") {
      existing.unavailableCostRuns += 1;
    } else {
      existing.unknownCostRuns += 1;
    }
    groups.set(key, existing);
  }
  return [...groups.entries()].map(([key, agg]) => ({
    key,
    commits: agg.commits,
    measuredCostRuns: agg.measuredCostRuns,
    unavailableCostRuns: agg.unavailableCostRuns,
    unknownCostRuns: agg.unknownCostRuns,
    totalCostUsd: agg.measuredCostRuns > 0 ? agg.measuredCostUsd : null,
  }));
}

function sortPriorityClosureRows(
  rows: BuilderCostGroup<ReportPriority>[],
): BuilderCostGroup<ReportPriority>[] {
  const order = new Map<ReportPriority, number>([
    ["p0", 0],
    ["p1", 1],
    ["p2", 2],
    ["p3", 3],
    ["unknown", 4],
  ]);
  return rows.sort((a, b) => (order.get(a.key) ?? 5) - (order.get(b.key) ?? 5));
}
