/**
 * Pure aggregation for the operator-facing autonomy balance/quality report.
 *
 * Reads only existing repo surfaces: `data/tasks/`, run metadata under the
 * runs directory, and run artifacts. Per the no-cost-bias-in-autonomy
 * contract this output is operator-facing only and must not be consumed by
 * autonomy agents.
 */

import { collectReviewScrutinyReport } from "#modules/autonomy/review-scrutiny.js";
import {
  buildReviewScrutinyEscalationReport,
  detectRecurringReviewScrutinyPatternsFromReport,
} from "#modules/autonomy/review-scrutiny-escalation.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  listFullRepoTasks,
  listRepoTaskDependencyWaits,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { loadRunsInWindow } from "#modules/workflow-ops/runs/workflow-history.js";
import { buildBlockerMix } from "./aggregate-blockers.js";
import { buildBuilderBreakdown } from "./aggregate-builder.js";
import { buildCostBreakdown } from "./aggregate-cost.js";
import { buildExplorerBalance } from "./aggregate-explorer.js";
import { buildAutonomyHealthBreakdown } from "./aggregate-health.js";
import { buildQueueBalance } from "./aggregate-queue.js";
import { buildTrajectoryDiagnosticReport } from "./aggregate-trajectory.js";
import {
  type AutonomyReportData,
  type AutonomyReportInput,
  DEFAULT_REPORT_WINDOW_DAYS,
} from "./aggregate-types.js";
import { buildPostCompletionFollowUpReport } from "./post-completion-followups.js";

export {
  type AreaCount,
  type AutonomyHealthBreakdown,
  type AutonomyReportData,
  type AutonomyReportInput,
  type BlockerClassMix,
  type BlockerKind,
  type BuilderBreakdown,
  type BuilderClosure,
  type CostBreakdown,
  DEFAULT_REPORT_WINDOW_DAYS,
  type ExplorerBalance,
  type ExplorerTaskAddition,
  type HealthCountRow,
  type HealthTopGroup,
  type PriorityCount,
  type QueueBalance,
  type QueueDependencyWait,
  type ReportPriority,
  type StateCount,
  type TaskClassCount,
  type TrajectoryDiagnosticPatternSummary,
  type TrajectoryDiagnosticReport,
  type WorkflowCostRow,
} from "./aggregate-types.js";
export type { AreaClassification } from "./task-classification.js";
export { classifyTaskShape } from "./task-classification.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function aggregateAutonomyReport(
  input: AutonomyReportInput,
): AutonomyReportData {
  const windowDays = input.windowDays ?? DEFAULT_REPORT_WINDOW_DAYS;
  const windowMs = windowDays * MS_PER_DAY;
  const windowStartMs = input.windowEndMs - windowMs;

  const allTasks = listFullRepoTasks(input.projectDir);
  const taskById = buildTaskLookup(allTasks);
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
  const reviewScrutiny = collectReviewScrutinyReport({
    runsDir: input.runsDir,
    runs,
  });
  const reviewScrutinyEscalationDetection =
    detectRecurringReviewScrutinyPatternsFromReport({
      report: reviewScrutiny,
      tasks: allTasks,
      config: { nowMs: input.windowEndMs, windowMs },
    });

  return {
    windowStartedAt: new Date(windowStartMs).toISOString(),
    windowEndedAt: new Date(input.windowEndMs).toISOString(),
    windowDays,
    openQueue,
    doneInWindow,
    explorer: buildExplorerBalance(runs, taskById, input.addedFilesBySha),
    builder: buildBuilderBreakdown(runs, taskById, input.runsDir),
    reviewScrutiny,
    reviewScrutinyEscalation: buildReviewScrutinyEscalationReport({
      projectDir: input.projectDir,
      detection: reviewScrutinyEscalationDetection,
      config: { nowMs: input.windowEndMs, windowMs },
    }),
    trajectoryDiagnostics: buildTrajectoryDiagnosticReport(
      input.runsDir,
      input.windowEndMs,
      windowMs,
    ),
    postCompletionFollowUps: buildPostCompletionFollowUpReport({
      tasks: allTasks,
      runs,
      runsDir: input.runsDir,
      windowStartMs,
      windowEndMs: input.windowEndMs,
    }),
    health: buildAutonomyHealthBreakdown(
      input.runsDir,
      windowStartMs,
      input.windowEndMs,
    ),
    blockers: buildBlockerMix(allTasks),
    cost: buildCostBreakdown(runs),
  };
}

function buildTaskLookup(
  allTasks: RepoTaskFullRecord[],
): Map<string, RepoTaskFullRecord> {
  const taskById = new Map<string, RepoTaskFullRecord>();
  for (const task of allTasks) taskById.set(task.id, task);
  return taskById;
}
