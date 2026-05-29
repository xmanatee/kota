/**
 * Pure aggregation for the operator-facing autonomy balance/quality report.
 *
 * Reads only the repo's existing surfaces — `data/tasks/`, run metadata under
 * the runs directory, and `run-summary.json` artifacts — and produces the
 * dimensions the 2026-04-28 broad daemon review currently reproduces by hand:
 * priority / area mix, explorer strategic vs fan-out share, builder breakdown
 * by area, blocker classes, and per-workflow cost.
 *
 * Per the no-cost-bias-in-autonomy contract this output is operator-facing
 * only and must not be consumed by autonomy agents.
 */

import { basename } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { WorkflowRunSummary } from "#modules/autonomy/run-summary.js";
import {
  DEFAULT_TRAJECTORY_DIAGNOSTIC_REPORT_LIMIT,
  detectRecurringTrajectoryDiagnosticPatterns,
  type TrajectoryDiagnosticPattern,
} from "#modules/autonomy/trajectory-diagnostic-escalation.js";
import {
  type BlockedPreconditionKind,
  parseBlockedPrecondition,
} from "#modules/repo-tasks/blocked-precondition.js";
import {
  listFullRepoTasks,
  listRepoTaskDependencyWaits,
  type RepoTaskFullRecord,
  type RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { loadRunsInWindow } from "#modules/workflow-ops/runs/workflow-history.js";
import {
  type AreaClassification,
  classifyTaskShape,
} from "./task-classification.js";

export type { AreaClassification } from "./task-classification.js";
export { classifyTaskShape } from "./task-classification.js";

export const DEFAULT_REPORT_WINDOW_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ReportPriority = "p0" | "p1" | "p2" | "p3" | "unknown";

const KNOWN_PRIORITIES: ReportPriority[] = ["p0", "p1", "p2", "p3"];

function normalizePriority(raw: string): ReportPriority {
  return (KNOWN_PRIORITIES as readonly string[]).includes(raw)
    ? (raw as ReportPriority)
    : "unknown";
}

export type PriorityCount = { priority: ReportPriority; count: number };
export type AreaCount = { area: string; count: number };
export type StateCount = { state: RepoTaskState; count: number };
export type QueueDependencyWait = {
  taskId: string;
  title: string;
  state: RepoTaskState;
  waitingOn: string[];
};

export type QueueBalance = {
  total: number;
  byPriority: PriorityCount[];
  byArea: AreaCount[];
  byState: StateCount[];
  waitingOnTasks: QueueDependencyWait[];
};

export type ExplorerTaskAddition = {
  runId: string;
  taskId: string;
  title: string;
  area: string;
  priority: ReportPriority;
  classification: AreaClassification;
};

export type ExplorerBalance = {
  totalRuns: number;
  totalTaskAdditions: number;
  /** Sum across explorer runs in window of tasks-not-found (path could not be resolved to a known task). */
  unresolvedTaskAdditions: number;
  byClassification: { classification: AreaClassification; tasks: number }[];
  taskAdditions: ExplorerTaskAddition[];
};

export type BuilderClosure = {
  runId: string;
  taskId: string;
  taskTitle: string;
  area: string;
  priority: ReportPriority;
  classification: AreaClassification;
  costUsd: number | null;
  durationMs: number | null;
};

export type BuilderBreakdown = {
  totalCommittedRuns: number;
  /** Builder runs that committed but whose task could not be resolved to current state. */
  unresolvedClosures: number;
  byArea: { area: string; commits: number; totalCostUsd: number }[];
  byPriority: { priority: ReportPriority; commits: number; totalCostUsd: number }[];
  byClassification: {
    classification: AreaClassification;
    commits: number;
    totalCostUsd: number;
  }[];
  closures: BuilderClosure[];
};

export type BlockerKind =
  | BlockedPreconditionKind
  | "missing-section"
  | "malformed";

export type BlockerClassMix = {
  totalBlocked: number;
  byKind: { kind: BlockerKind; count: number }[];
};

export type WorkflowCostRow = {
  workflow: string;
  finishedRuns: number;
  totalCostUsd: number;
  averageCostUsd: number;
};

export type CostBreakdown = {
  totalCostUsd: number;
  finishedRuns: number;
  averagePerFinishedRun: number;
  byWorkflow: WorkflowCostRow[];
};

export type TrajectoryDiagnosticPatternSummary = {
  workflow: string;
  stepId: string;
  code: TrajectoryDiagnosticPattern["code"];
  runCount: number;
  repairTaskId: string;
  evidenceArtifactPaths: string[];
};

export type TrajectoryDiagnosticReport = {
  activePatterns: TrajectoryDiagnosticPatternSummary[];
};

export type AutonomyReportData = {
  windowStartedAt: string;
  windowEndedAt: string;
  windowDays: number;
  openQueue: QueueBalance;
  doneInWindow: QueueBalance;
  explorer: ExplorerBalance;
  builder: BuilderBreakdown;
  trajectoryDiagnostics: TrajectoryDiagnosticReport;
  blockers: BlockerClassMix;
  cost: CostBreakdown;
};

export type AutonomyReportInput = {
  projectDir: string;
  runsDir: string;
  windowEndMs: number;
  windowDays?: number;
  /**
   * Optional fallback map from commit SHA to repo-relative paths added by that
   * commit. The aggregator consults this map for explorer runs whose commit
   * step output records a `sha` but no inline `addedTaskFiles` array (older
   * runs and runs where the explorer step did not surface its own list of
   * staged paths). Tests omit this map and supply `addedTaskFiles` directly.
   */
  addedFilesBySha?: Map<string, readonly string[]>;
};

export function aggregateAutonomyReport(
  input: AutonomyReportInput,
): AutonomyReportData {
  const windowDays = input.windowDays ?? DEFAULT_REPORT_WINDOW_DAYS;
  const windowMs = windowDays * MS_PER_DAY;
  const windowStartMs = input.windowEndMs - windowMs;

  const allTasks = listFullRepoTasks(input.projectDir);
  const taskById = new Map<string, RepoTaskFullRecord>();
  for (const t of allTasks) taskById.set(t.id, t);

  const openQueue = buildQueueBalance(
    allTasks.filter((t) =>
      t.state === "backlog" ||
      t.state === "ready" ||
      t.state === "doing" ||
      t.state === "blocked",
    ),
    listRepoTaskDependencyWaits(input.projectDir, [
      "backlog",
      "ready",
      "doing",
      "blocked",
    ]),
  );

  const doneInWindow = buildQueueBalance(
    allTasks.filter(
      (t) =>
        t.state === "done" &&
        Date.parse(t.updatedAt) >= windowStartMs &&
        Date.parse(t.updatedAt) <= input.windowEndMs,
    ),
    [],
  );

  const runs = loadRunsInWindow(input.runsDir, windowStartMs).filter(
    (r) => Date.parse(r.startedAt) <= input.windowEndMs,
  );

  const explorer = buildExplorerBalance(
    runs,
    taskById,
    input.addedFilesBySha,
  );
  const builder = buildBuilderBreakdown(runs, taskById, input.runsDir);
  const trajectoryDiagnostics = buildTrajectoryDiagnosticReport(
    input.runsDir,
    input.windowEndMs,
    windowMs,
  );
  const blockers = buildBlockerMix(allTasks);
  const cost = buildCostBreakdown(runs);

  return {
    windowStartedAt: new Date(windowStartMs).toISOString(),
    windowEndedAt: new Date(input.windowEndMs).toISOString(),
    windowDays,
    openQueue,
    doneInWindow,
    explorer,
    builder,
    trajectoryDiagnostics,
    blockers,
    cost,
  };
}

function buildQueueBalance(
  records: RepoTaskFullRecord[],
  waitingOnTasks: ReturnType<typeof listRepoTaskDependencyWaits>,
): QueueBalance {
  const priorityCounts = new Map<ReportPriority, number>();
  const areaCounts = new Map<string, number>();
  const stateCounts = new Map<RepoTaskState, number>();
  for (const t of records) {
    const priority = normalizePriority(t.priority);
    priorityCounts.set(priority, (priorityCounts.get(priority) ?? 0) + 1);
    const area = t.area || "(unset)";
    areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
    stateCounts.set(t.state, (stateCounts.get(t.state) ?? 0) + 1);
  }
  return {
    total: records.length,
    byPriority: sortByPriority(
      [...priorityCounts.entries()].map(([priority, count]) => ({ priority, count })),
    ),
    byArea: [...areaCounts.entries()]
      .map(([area, count]) => ({ area, count }))
      .sort((a, b) => b.count - a.count || a.area.localeCompare(b.area)),
    byState: [...stateCounts.entries()]
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => a.state.localeCompare(b.state)),
    waitingOnTasks: waitingOnTasks.map((wait) => ({
      taskId: wait.id,
      title: wait.title,
      state: wait.state,
      waitingOn: wait.waitingOn,
    })),
  };
}

function sortByPriority(rows: PriorityCount[]): PriorityCount[] {
  const order = new Map<ReportPriority, number>([
    ["p0", 0],
    ["p1", 1],
    ["p2", 2],
    ["p3", 3],
    ["unknown", 4],
  ]);
  return [...rows].sort(
    (a, b) => (order.get(a.priority) ?? 5) - (order.get(b.priority) ?? 5),
  );
}

function buildExplorerBalance(
  runs: WorkflowRunMetadata[],
  taskById: Map<string, RepoTaskFullRecord>,
  addedFilesBySha: Map<string, readonly string[]> | undefined,
): ExplorerBalance {
  const additions: ExplorerTaskAddition[] = [];
  let totalRuns = 0;
  let unresolvedTaskAdditions = 0;
  for (const run of runs) {
    if (run.workflow !== "explorer") continue;
    if (run.status !== "success") continue;
    totalRuns += 1;
    const commit = run.steps.find((s) => s.id === "commit");
    if (!commit || commit.status !== "success") continue;
    const output = commit.output as
      | { addedTaskFiles?: unknown; sha?: unknown }
      | undefined;
    const addedTaskFiles = resolveAddedTaskFiles(output, addedFilesBySha);
    if (addedTaskFiles.length === 0) continue;
    for (const filePath of addedTaskFiles) {
      const taskId = extractTaskIdFromFilePath(filePath);
      if (!taskId) {
        unresolvedTaskAdditions += 1;
        continue;
      }
      const task = taskById.get(taskId);
      if (!task) {
        unresolvedTaskAdditions += 1;
        continue;
      }
      additions.push({
        runId: run.id,
        taskId,
        title: task.title,
        area: task.area || "(unset)",
        priority: normalizePriority(task.priority),
        classification: classifyTaskShape({
          area: task.area,
          title: task.title,
          summary: task.summary,
        }),
      });
    }
  }
  const byClassification = countClassifications(additions.map((a) => a.classification));
  return {
    totalRuns,
    totalTaskAdditions: additions.length,
    unresolvedTaskAdditions,
    byClassification,
    taskAdditions: additions,
  };
}

function resolveAddedTaskFiles(
  output: { addedTaskFiles?: unknown; sha?: unknown } | undefined,
  addedFilesBySha: Map<string, readonly string[]> | undefined,
): string[] {
  if (Array.isArray(output?.addedTaskFiles)) {
    return output.addedTaskFiles.filter(
      (entry): entry is string => typeof entry === "string",
    );
  }
  if (addedFilesBySha && typeof output?.sha === "string") {
    const fromGit = addedFilesBySha.get(output.sha);
    if (fromGit) {
      return fromGit.filter((entry) => entry.startsWith("data/tasks/"));
    }
  }
  return [];
}

function extractTaskIdFromFilePath(filePath: string): string | null {
  const name = basename(filePath);
  if (!name.endsWith(".md")) return null;
  const id = name.slice(0, -3);
  if (!id.startsWith("task-")) return null;
  return id;
}

function countClassifications(
  values: AreaClassification[],
): { classification: AreaClassification; tasks: number }[] {
  const counts = new Map<AreaClassification, number>([
    ["strategic", 0],
    ["fan-out", 0],
    ["other", 0],
  ]);
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].map(([classification, tasks]) => ({
    classification,
    tasks,
  }));
}

function buildBuilderBreakdown(
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
  ).map(({ area, ...rest }) => ({ classification: area as AreaClassification, ...rest }));

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
  const groups = new Map<ReportPriority, { commits: number; totalCostUsd: number }>();
  for (const c of closures) {
    const existing = groups.get(c.priority) ?? { commits: 0, totalCostUsd: 0 };
    existing.commits += 1;
    existing.totalCostUsd += c.costUsd ?? 0;
    groups.set(c.priority, existing);
  }
  const rows = [...groups.entries()].map(([key, agg]) => ({ key, ...agg }));
  const order = new Map<ReportPriority, number>([
    ["p0", 0],
    ["p1", 1],
    ["p2", 2],
    ["p3", 3],
    ["unknown", 4],
  ]);
  return rows.sort((a, b) => (order.get(a.key) ?? 5) - (order.get(b.key) ?? 5));
}

function buildBlockerMix(allTasks: RepoTaskFullRecord[]): BlockerClassMix {
  const blocked = allTasks.filter((t) => t.state === "blocked");
  const counts = new Map<BlockerKind, number>();
  for (const task of blocked) {
    const parsed = parseBlockedPrecondition(task.body);
    const kind: BlockerKind = parsed.ok
      ? parsed.precondition.kind
      : parsed.error === "missing-section"
        ? "missing-section"
        : "malformed";
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const order = new Map<BlockerKind, number>([
    ["task-done", 0],
    ["capability-installed", 1],
    ["owner-decision", 2],
    ["operator-capture", 3],
    ["missing-section", 4],
    ["malformed", 5],
  ]);
  return {
    totalBlocked: blocked.length,
    byKind: [...counts.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => (order.get(a.kind) ?? 9) - (order.get(b.kind) ?? 9)),
  };
}

function buildTrajectoryDiagnosticReport(
  runsDir: string,
  windowEndMs: number,
  windowMs: number,
): TrajectoryDiagnosticReport {
  const patterns = detectRecurringTrajectoryDiagnosticPatterns(runsDir, {
    nowMs: windowEndMs,
    windowMs,
  });
  return {
    activePatterns: patterns
      .slice(0, DEFAULT_TRAJECTORY_DIAGNOSTIC_REPORT_LIMIT)
      .map((pattern) => ({
        workflow: pattern.workflow,
        stepId: pattern.stepId,
        code: pattern.code,
        runCount: pattern.runCount,
        repairTaskId: pattern.taskId,
        evidenceArtifactPaths: pattern.artifactPaths,
      })),
  };
}

function buildCostBreakdown(runs: WorkflowRunMetadata[]): CostBreakdown {
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
