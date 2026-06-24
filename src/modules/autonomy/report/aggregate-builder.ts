import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { WorkflowRunSummary } from "#modules/autonomy/run-summary.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import { normalizePriority } from "./aggregate-queue.js";
import type {
  BuilderBreakdown,
  BuilderClosure,
  ReportPriority,
} from "./aggregate-types.js";
import type { AreaClassification } from "./task-classification.js";
import { classifyTaskShape } from "./task-classification.js";

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
    const summary = readOptionalJsonFile<WorkflowRunSummary>(
      `${runsDir}/${run.id}/run-summary.json`,
    );
    if (!summary || !summary.taskId) {
      unresolvedClosures += 1;
      continue;
    }
    const task = taskById.get(summary.taskId);
    if (!task) {
      unresolvedClosures += 1;
      continue;
    }
    closures.push({
      runId: run.id,
      taskId: summary.taskId,
      taskTitle: summary.taskTitle ?? task.title,
      area: task.area || "(unset)",
      priority: normalizePriority(task.priority),
      classification: classifyTaskShape({
        area: task.area,
        title: task.title,
        summary: task.summary,
      }),
      costUsd: run.totalCostUsd ?? null,
      durationMs: run.durationMs ?? null,
    });
  }

  const byArea = aggregateClosures(closures, (c) => c.area).sort(
    (a, b) => b.commits - a.commits || a.area.localeCompare(b.area),
  );
  const byPriority = aggregatePriorityClosures(closures).map(
    ({ key, commits, totalCostUsd }) => ({
      priority: key,
      commits,
      totalCostUsd,
    }),
  );
  const byClassification = aggregateClosures(
    closures,
    (c) => c.classification,
  ).map(({ area, ...rest }) => ({
    classification: area as AreaClassification,
    ...rest,
  }));

  return {
    totalCommittedRuns: closures.length,
    unresolvedClosures,
    byArea,
    byPriority,
    byClassification,
    closures,
  };
}

function aggregateClosures(
  closures: BuilderClosure[],
  keyFn: (c: BuilderClosure) => string,
): { area: string; commits: number; totalCostUsd: number }[] {
  const groups = new Map<string, { commits: number; totalCostUsd: number }>();
  for (const c of closures) {
    const key = keyFn(c);
    const existing = groups.get(key) ?? { commits: 0, totalCostUsd: 0 };
    existing.commits += 1;
    existing.totalCostUsd += c.costUsd ?? 0;
    groups.set(key, existing);
  }
  return [...groups.entries()].map(([area, agg]) => ({ area, ...agg }));
}

function aggregatePriorityClosures(
  closures: BuilderClosure[],
): { key: ReportPriority; commits: number; totalCostUsd: number }[] {
  const groups = new Map<
    ReportPriority,
    { commits: number; totalCostUsd: number }
  >();
  for (const c of closures) {
    const existing = groups.get(c.priority) ?? { commits: 0, totalCostUsd: 0 };
    existing.commits += 1;
    existing.totalCostUsd += c.costUsd ?? 0;
    groups.set(c.priority, existing);
  }
  return sortPriorityClosureRows(
    [...groups.entries()].map(([key, agg]) => ({ key, ...agg })),
  );
}

function sortPriorityClosureRows(
  rows: { key: ReportPriority; commits: number; totalCostUsd: number }[],
): { key: ReportPriority; commits: number; totalCostUsd: number }[] {
  const order = new Map<ReportPriority, number>([
    ["p0", 0],
    ["p1", 1],
    ["p2", 2],
    ["p3", 3],
    ["unknown", 4],
  ]);
  return rows.sort((a, b) => (order.get(a.key) ?? 5) - (order.get(b.key) ?? 5));
}
