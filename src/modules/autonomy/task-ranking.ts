import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";

const PRIORITY_RANK: Record<string, number> = {
  p0: 0,
  p1: 1,
  p2: 2,
  p3: 3,
};

/** Priority is authored judgment; filename identity makes ties stable. */
export function compareAutonomyTasks(
  a: RepoTaskFullRecord,
  b: RepoTaskFullRecord,
): number {
  const priorityDelta =
    (PRIORITY_RANK[a.priority ?? ""] ?? 99) - (PRIORITY_RANK[b.priority ?? ""] ?? 99);
  if (priorityDelta !== 0) return priorityDelta;
  return a.id.localeCompare(b.id);
}

export function describeAutonomyTaskRank(
  record: RepoTaskFullRecord,
  rank: number,
): string {
  return [
    `rank ${rank + 1}`,
    `priority ${record.priority || "unset"}`,
    `task ${record.id}`,
  ].join("; ");
}
