import { existsSync } from "node:fs";
import { join } from "node:path";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { readAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.js";
import { inspectAutonomyIssueOwner } from "#modules/autonomy/autonomy-issue-reconciliation.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import type {
  AutonomyHealthBreakdown,
  HealthCountRow,
  HealthTopGroup,
} from "./aggregate-types.js";

function countMapAdd(map: Map<string, number>, key: string, count: number): void {
  map.set(key, (map.get(key) ?? 0) + count);
}

function countRows<TKey extends string>(
  map: Map<string, number>,
  key: TKey,
): HealthCountRow<TKey>[] {
  return [...map.entries()]
    .map(([label, count]) => ({ [key]: label, count }) as HealthCountRow<TKey>)
    .sort((left, right) =>
      right.count - left.count || left[key].localeCompare(right[key]),
    );
}

export function buildAutonomyHealthBreakdown(
  workspaceRoot: string,
  stateDir: string,
): AutonomyHealthBreakdown {
  const projection = readAutonomyIssueProjection(workspaceRoot);
  const tasks = listFullRepoTasks(workspaceRoot);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const ownerQuestionDir = join(workspaceRoot, ".kota", "owner-questions");
  const questions = existsSync(ownerQuestionDir)
    ? new OwnerQuestionQueue(ownerQuestionDir).list()
    : [];
  const questionById = new Map(questions.map((question) => [question.id, question]));
  let runs: ReturnType<RunStateDatabase["listRuns"]> = [];
  if (existsSync(join(stateDir, "kota.sqlite"))) {
    const database = RunStateDatabase.openReadOnly(stateDir);
    try {
      const scopeId = database.getScopeIdByRootPath(workspaceRoot);
      if (scopeId !== null) runs = database.listRuns(scopeId);
    } finally {
      database.close();
    }
  }
  const bySeverity = new Map<string, number>();
  const byLabel = new Map<string, number>();
  const byScope = new Map<string, number>();
  const bySource = new Map<string, number>();
  const byActionability = new Map<string, number>();
  const byStatus = new Map<string, number>();
  const byPhase = new Map<string, number>();
  const topGroups: HealthTopGroup[] = [];
  let totalSignals = 0;

  for (const issue of projection.issues) {
    const owner = inspectAutonomyIssueOwner({
      issue,
      runs,
      taskById,
      questionById,
      requestedAt: new Date().toISOString(),
    });
    totalSignals += issue.occurrenceCount;
    countMapAdd(bySeverity, issue.severity, issue.occurrenceCount);
    countMapAdd(byScope, "scope", issue.occurrenceCount);
    countMapAdd(
      bySource,
      `${issue.source.kind}:${issue.source.id}`,
      issue.occurrenceCount,
    );
    countMapAdd(byActionability, issue.actionability, issue.occurrenceCount);
    countMapAdd(byStatus, issue.status, 1);
    countMapAdd(byPhase, owner.phase, 1);
    for (const label of issue.labels) {
      countMapAdd(byLabel, label, issue.occurrenceCount);
    }
    topGroups.push({
      dedupeKey: issue.rootCauseKey,
      labels: [...issue.labels],
      severity: issue.severity,
      actionability: issue.actionability,
      signalCount: issue.occurrenceCount,
      source: `${issue.source.kind}:${issue.source.id}`,
      scope: "scope",
      status: issue.status,
      phase: owner.phase,
    });
  }

  return {
    totalSignals,
    totalGroups: projection.issues.length,
    bySeverity: countRows(bySeverity, "severity"),
    byLabel: countRows(byLabel, "label"),
    byScope: countRows(byScope, "scope"),
    bySource: countRows(bySource, "source"),
    byActionability: countRows(byActionability, "actionability"),
    byStatus: countRows(byStatus, "status"),
    byPhase: countRows(byPhase, "phase"),
    topGroups: topGroups
      .sort(
        (left, right) =>
          right.signalCount - left.signalCount ||
          left.dedupeKey.localeCompare(right.dedupeKey),
      )
      .slice(0, 10),
  };
}
