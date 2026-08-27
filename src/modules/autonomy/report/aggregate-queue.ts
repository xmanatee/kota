import type { RepoTaskFullRecord, RepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";
import type {
  PriorityCount,
  QueueBalance,
  ReportPriority,
} from "./aggregate-types.js";

const KNOWN_PRIORITIES: ReportPriority[] = ["p0", "p1", "p2", "p3"];

type RepoTaskDependencyWait = {
  id: string;
  title: string;
  state: RepoTaskState;
  waitingOn: string[];
};

export function normalizePriority(raw: string | null): ReportPriority {
  return raw !== null && (KNOWN_PRIORITIES as readonly string[]).includes(raw)
    ? (raw as ReportPriority)
    : "unknown";
}

export function buildQueueBalance(
  records: RepoTaskFullRecord[],
  waitingOnTasks: RepoTaskDependencyWait[],
): QueueBalance {
  const priorityCounts = new Map<ReportPriority, number>();
  const stateCounts = new Map<RepoTaskState, number>();
  for (const t of records) {
    const priority = normalizePriority(t.priority);
    priorityCounts.set(priority, (priorityCounts.get(priority) ?? 0) + 1);
    stateCounts.set(t.state, (stateCounts.get(t.state) ?? 0) + 1);
  }
  return {
    total: records.length,
    byPriority: sortByPriority(
      [...priorityCounts.entries()].map(([priority, count]) => ({
        priority,
        count,
      })),
    ),
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

export function sortByPriority(rows: PriorityCount[]): PriorityCount[] {
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
