import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";

const PRIORITY_RANK: Record<string, number> = {
  p0: 0,
  p1: 1,
  p2: 2,
  p3: 3,
};

function timestamp(record: RepoTaskFullRecord): number {
  const value = Date.parse(record.updatedAt);
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

/** Priority is authored judgment; age and id only make ties stable. */
export function compareAutonomyTasks(
  a: RepoTaskFullRecord,
  b: RepoTaskFullRecord,
): number {
  const priorityDelta =
    (PRIORITY_RANK[a.priority] ?? 99) - (PRIORITY_RANK[b.priority] ?? 99);
  if (priorityDelta !== 0) return priorityDelta;
  const ageDelta = timestamp(a) - timestamp(b);
  return ageDelta !== 0 ? ageDelta : a.id.localeCompare(b.id);
}

export function describeAutonomyTaskRank(
  record: RepoTaskFullRecord,
  rank: number,
): string {
  return [
    `rank ${rank + 1}`,
    `priority ${record.priority || "unset"}`,
    `updated_at ${record.updatedAt}`,
  ].join("; ");
}
