import { readAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.js";
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
  projectDir: string,
): AutonomyHealthBreakdown {
  const projection = readAutonomyIssueProjection(projectDir);
  const bySeverity = new Map<string, number>();
  const byLabel = new Map<string, number>();
  const byScope = new Map<string, number>();
  const bySource = new Map<string, number>();
  const byActionability = new Map<string, number>();
  const byStatus = new Map<string, number>();
  const topGroups: HealthTopGroup[] = [];
  let totalSignals = 0;

  for (const issue of projection.issues) {
    totalSignals += issue.occurrenceCount;
    countMapAdd(bySeverity, issue.severity, issue.occurrenceCount);
    countMapAdd(byScope, "project", issue.occurrenceCount);
    countMapAdd(
      bySource,
      `${issue.source.kind}:${issue.source.id}`,
      issue.occurrenceCount,
    );
    countMapAdd(byActionability, issue.actionability, issue.occurrenceCount);
    countMapAdd(byStatus, issue.status, 1);
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
      scope: "project",
      status: issue.status,
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
    topGroups: topGroups
      .sort(
        (left, right) =>
          right.signalCount - left.signalCount ||
          left.dedupeKey.localeCompare(right.dedupeKey),
      )
      .slice(0, 10),
  };
}
