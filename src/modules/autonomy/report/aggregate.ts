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
import { buildAutonomyChangeDecisionReport } from "./autonomy-change-decisions.js";
import { buildDecisionAttributionReport } from "./decision-attribution.js";
import { buildDiffSummaryConsistencyReport } from "./diff-summary-consistency-report.js";
import { buildOwnerInterventionReport } from "./owner-interventions.js";
import {
  buildPostCompletionCorrectiveLinks,
  summarizePostCompletionFollowUpLinks,
} from "./post-completion-followups.js";
import { buildProcessDisciplineReport } from "./process-discipline-report.js";
import { buildQualityStratificationReport } from "./quality-stratification.js";
import { buildShadowSemanticReviewReport } from "./shadow-semantic-reviews.js";
import { buildSupervisionLoadReport } from "./supervision-load.js";

export {
  type AreaCount,
  type AutonomyChangeDecisionReport,
  type AutonomyChangeDecisionSummary,
  type AutonomyHealthBreakdown,
  type AutonomyReportData,
  type AutonomyReportInput,
  type BlockerClassMix,
  type BlockerKind,
  type BuilderBreakdown,
  type BuilderClosure,
  type CostBreakdown,
  DEFAULT_REPORT_WINDOW_DAYS,
  type DecisionAttributionReport,
  type DiffSummaryConsistencyReport,
  type ExplorerBalance,
  type ExplorerTaskAddition,
  type HealthCountRow,
  type HealthTopGroup,
  type OwnerInterventionReport,
  type PriorityCount,
  type ProcessDisciplineReport,
  type QualityStratificationReport,
  type QueueBalance,
  type QueueDependencyWait,
  type ReportPriority,
  type ShadowSemanticReviewReport,
  type StateCount,
  type SupervisionLoadReport,
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

  const allTasks = listFullRepoTasks(input.workspaceRoot);
  const taskById = buildTaskLookup(allTasks);
  const openQueue = buildQueueBalance(
    allTasks.filter((t) =>
      t.state === "backlog" ||
      t.state === "ready" ||
      t.state === "doing" ||
      t.state === "blocked",
    ),
    listRepoTaskDependencyWaits(input.workspaceRoot, [
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

  const reportRuns = loadRunsInWindow(input.runsDir, windowStartMs - windowMs).filter(
    (r) => Date.parse(r.startedAt) <= input.windowEndMs,
  );
  const runs = reportRuns.filter(
    (r) => Date.parse(r.startedAt) >= windowStartMs,
  );
  const priorRuns = reportRuns.filter((run) => {
    const startedMs = Date.parse(run.startedAt);
    return startedMs >= windowStartMs - windowMs && startedMs < windowStartMs;
  });
  const reviewScrutiny = collectReviewScrutinyReport({
    runsDir: input.runsDir,
    runs,
  });
  const priorReviewScrutiny = collectReviewScrutinyReport({
    runsDir: input.runsDir,
    runs: priorRuns,
  });
  const ownerInterventions = buildOwnerInterventionReport({
    workspaceRoot: input.workspaceRoot,
    windowStartMs,
    windowEndMs: input.windowEndMs,
  });
  const reviewScrutinyEscalationDetection =
    detectRecurringReviewScrutinyPatternsFromReport({
      report: reviewScrutiny,
      tasks: allTasks,
      config: { nowMs: input.windowEndMs, windowMs },
    });
  const postCompletionFollowUpLinks = buildPostCompletionCorrectiveLinks({
    tasks: allTasks,
    runs,
    runsDir: input.runsDir,
    windowStartMs,
    windowEndMs: input.windowEndMs,
  });
  const postCompletionFollowUps = summarizePostCompletionFollowUpLinks(
    postCompletionFollowUpLinks,
  );
  const priorPostCompletionFollowUpLinks = buildPostCompletionCorrectiveLinks({
    tasks: allTasks,
    runs: priorRuns,
    runsDir: input.runsDir,
    windowStartMs: windowStartMs - windowMs,
    windowEndMs: windowStartMs - 1,
  });
  const priorPostCompletionFollowUps = summarizePostCompletionFollowUpLinks(
    priorPostCompletionFollowUpLinks,
  );
  const supervisionLoad = buildSupervisionLoadReport({
    workspaceRoot: input.workspaceRoot,
    runsDir: input.runsDir,
    runs: reportRuns,
    tasks: allTasks,
    windowEndMs: input.windowEndMs,
    reviewScrutiny,
    postCompletionFollowUps,
  });

  return {
    windowStartedAt: new Date(windowStartMs).toISOString(),
    windowEndedAt: new Date(input.windowEndMs).toISOString(),
    windowDays,
    supervisionLoad,
    openQueue,
    doneInWindow,
    explorer: buildExplorerBalance(runs, taskById, input.runsDir),
    builder: buildBuilderBreakdown(runs, taskById, input.runsDir),
    decisionAttribution: buildDecisionAttributionReport({
      runs,
      runsDir: input.runsDir,
      taskById,
      reviewRecords: reviewScrutiny.records,
      ownerInterventions,
    }),
    diffSummaryConsistency: buildDiffSummaryConsistencyReport({
      runs,
      runsDir: input.runsDir,
    }),
    reviewScrutiny,
    reviewScrutinyEscalation: buildReviewScrutinyEscalationReport({
      workspaceRoot: input.workspaceRoot,
      detection: reviewScrutinyEscalationDetection,
      config: { nowMs: input.windowEndMs, windowMs },
    }),
    shadowSemanticReviews: buildShadowSemanticReviewReport({
      runs,
      runsDir: input.runsDir,
    }),
    trajectoryDiagnostics: buildTrajectoryDiagnosticReport(
      input.runsDir,
      input.windowEndMs,
      windowMs,
    ),
    processDiscipline: buildProcessDisciplineReport({
      runs,
      runsDir: input.runsDir,
      taskById,
    }),
    autonomyChangeDecisions: buildAutonomyChangeDecisionReport({
      runs,
      runsDir: input.runsDir,
    }),
    ownerInterventions,
    postCompletionFollowUps,
    qualityStratification: buildQualityStratificationReport({
      tasks: allTasks,
      runs: reportRuns,
      runsDir: input.runsDir,
      windowStartMs,
      windowEndMs: input.windowEndMs,
      reviewScrutiny,
      priorReviewScrutiny,
      postCompletionFollowUps,
      priorPostCompletionFollowUps,
      postCompletionFollowUpLinks,
      priorPostCompletionFollowUpLinks,
    }),
    health: buildAutonomyHealthBreakdown(input.workspaceRoot),
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
