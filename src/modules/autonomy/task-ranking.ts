import {
  extractTaskSections,
  type RepoTaskClass,
  type RepoTaskFullRecord,
} from "#modules/repo-tasks/repo-tasks-domain.js";

const PRIORITY_RANK: Record<string, number> = {
  p0: 0,
  p1: 1,
  p2: 2,
  p3: 3,
};

const TASK_CLASS_RANK: Record<RepoTaskClass, number> = {
  Safety: 0,
  Product: 1,
  Platform: 2,
  Unclassified: 3,
  Meta: 4,
};

const STRATEGIC_AREAS = new Set([
  "architecture",
  "autonomy",
  "core",
  "modules",
]);

const WORKFLOW_FAILURE_REPAIR_TASK_ID_PREFIX =
  "task-repair-workflow-failure-pattern-";

function priorityScore(priority: string): number {
  return PRIORITY_RANK[priority] ?? 99;
}

function timestamp(record: RepoTaskFullRecord): number {
  const value = Date.parse(record.updatedAt);
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

export function isStrategicAutonomyTask(record: RepoTaskFullRecord): boolean {
  return STRATEGIC_AREAS.has(record.area);
}

export function isRuntimePostureRepair(record: RepoTaskFullRecord): boolean {
  if (record.taskClass !== "Meta") return false;
  if (!record.id.startsWith(WORKFLOW_FAILURE_REPAIR_TASK_ID_PREFIX)) return false;
  if (!record.body.includes("workflow-failure-pattern-fingerprint")) return false;
  const link = extractTaskSections(record.body, ["Product / Safety Link"])[
    "Product / Safety Link"
  ];
  return /\bruntime posture blocker\b/i.test(link ?? "") &&
    /\bProduct\/Safety\b/i.test(link ?? "");
}

function isPriorityOneDelivery(record: RepoTaskFullRecord): boolean {
  return record.priority === "p1" &&
    (record.taskClass === "Product" || record.taskClass === "Safety");
}

export function compareAutonomyTasks(
  a: RepoTaskFullRecord,
  b: RepoTaskFullRecord,
): number {
  const runtimeRepairDelta =
    Number(isRuntimePostureRepair(b)) - Number(isRuntimePostureRepair(a));
  if (runtimeRepairDelta !== 0) return runtimeRepairDelta;

  const deliveryOverMetaDelta =
    Number(isPriorityOneDelivery(b) && a.taskClass === "Meta") -
    Number(isPriorityOneDelivery(a) && b.taskClass === "Meta");
  if (deliveryOverMetaDelta !== 0) return deliveryOverMetaDelta;

  const priorityDelta = priorityScore(a.priority) - priorityScore(b.priority);
  if (priorityDelta !== 0) return priorityDelta;

  const classDelta = TASK_CLASS_RANK[a.taskClass] - TASK_CLASS_RANK[b.taskClass];
  if (classDelta !== 0) return classDelta;

  const strategicDelta =
    Number(isStrategicAutonomyTask(b)) - Number(isStrategicAutonomyTask(a));
  if (strategicDelta !== 0) return strategicDelta;

  const ageDelta = timestamp(a) - timestamp(b);
  if (ageDelta !== 0) return ageDelta;

  return a.id.localeCompare(b.id);
}

export function describeAutonomyTaskRank(
  record: RepoTaskFullRecord,
  rank: number,
): string {
  const parts = [`rank ${rank + 1}`, `priority ${record.priority || "unset"}`];
  if (isRuntimePostureRepair(record)) parts.push("runtime posture repair");
  parts.push(`task_class ${record.taskClass}`);
  if (record.area) parts.push(`area ${record.area}`);
  if (isStrategicAutonomyTask(record)) parts.push("strategic area");
  parts.push(`updated_at ${record.updatedAt}`);
  return parts.join("; ");
}
