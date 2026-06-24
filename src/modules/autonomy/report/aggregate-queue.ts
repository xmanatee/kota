import type {
  RepoTaskClass,
  RepoTaskFullRecord,
  RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import type {
  PriorityCount,
  QueueBalance,
  ReportPriority,
  TaskClassCount,
} from "./aggregate-types.js";

const KNOWN_PRIORITIES: ReportPriority[] = ["p0", "p1", "p2", "p3"];

type RepoTaskDependencyWait = {
  id: string;
  title: string;
  state: RepoTaskState;
  waitingOn: string[];
};

export function normalizePriority(raw: string): ReportPriority {
  return (KNOWN_PRIORITIES as readonly string[]).includes(raw)
    ? (raw as ReportPriority)
    : "unknown";
}

export function buildQueueBalance(
  records: RepoTaskFullRecord[],
  waitingOnTasks: RepoTaskDependencyWait[],
): QueueBalance {
  const priorityCounts = new Map<ReportPriority, number>();
  const areaCounts = new Map<string, number>();
  const stateCounts = new Map<RepoTaskState, number>();
  const taskClassCounts = new Map<RepoTaskClass, number>();
  for (const t of records) {
    const priority = normalizePriority(t.priority);
    priorityCounts.set(priority, (priorityCounts.get(priority) ?? 0) + 1);
    const area = t.area || "(unset)";
    areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
    stateCounts.set(t.state, (stateCounts.get(t.state) ?? 0) + 1);
    taskClassCounts.set(t.taskClass, (taskClassCounts.get(t.taskClass) ?? 0) + 1);
  }
  return {
    total: records.length,
    byPriority: sortByPriority(
      [...priorityCounts.entries()].map(([priority, count]) => ({
        priority,
        count,
      })),
    ),
    byArea: [...areaCounts.entries()]
      .map(([area, count]) => ({ area, count }))
      .sort((a, b) => b.count - a.count || a.area.localeCompare(b.area)),
    byState: [...stateCounts.entries()]
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => a.state.localeCompare(b.state)),
    byTaskClass: sortTaskClassCounts(
      [...taskClassCounts.entries()].map(([taskClass, count]) => ({
        taskClass,
        count,
      })),
    ),
    waitingOnTasks: waitingOnTasks.map((wait) => ({
      taskId: wait.id,
      title: wait.title,
      state: wait.state,
      waitingOn: wait.waitingOn,
    })),
  };
}

function sortTaskClassCounts(rows: TaskClassCount[]): TaskClassCount[] {
  const order = new Map<RepoTaskClass, number>([
    ["Safety", 0],
    ["Product", 1],
    ["Platform", 2],
    ["Meta", 3],
    ["Unclassified", 4],
  ]);
  return [...rows].sort(
    (a, b) =>
      (order.get(a.taskClass) ?? 9) - (order.get(b.taskClass) ?? 9) ||
      a.taskClass.localeCompare(b.taskClass),
  );
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
