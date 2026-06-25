import {
  extractTaskSections,
  getRepoTaskStateTransitionBlocker,
  listFullRepoTasks,
  listRepoTaskDependencyWaits,
  type RepoTaskClass,
  type RepoTaskFullRecord,
} from "#modules/repo-tasks/repo-tasks-domain.js";

/**
 * Maximum number of backlog tasks to promote per run. Kept small so the
 * `ready/` queue stays the short execution queue rather than absorbing the
 * whole backlog.
 */
export const PROMOTION_BATCH_LIMIT = 2;

/**
 * Areas considered strategic when ranking backlog candidates. Used as a
 * tie-breaker after priority and task class so architecture/autonomy/core work
 * surfaces above narrower fan-out at the same priority/class and age.
 */
const STRATEGIC_AREAS: ReadonlySet<string> = new Set([
  "architecture",
  "autonomy",
  "core",
  "modules",
]);

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

const WORKFLOW_FAILURE_REPAIR_TASK_ID_PREFIX =
  "task-repair-workflow-failure-pattern-";

function priorityScore(priority: string): number {
  const rank = PRIORITY_RANK[priority];
  return rank ?? 99;
}

function taskClassScore(taskClass: RepoTaskClass): number {
  return TASK_CLASS_RANK[taskClass];
}

function isStrategic(record: RepoTaskFullRecord): boolean {
  return STRATEGIC_AREAS.has(record.area);
}

function isRuntimePostureRepair(record: RepoTaskFullRecord): boolean {
  if (record.taskClass !== "Meta") return false;
  if (!record.id.startsWith(WORKFLOW_FAILURE_REPAIR_TASK_ID_PREFIX)) return false;
  if (!record.body.includes("workflow-failure-pattern-fingerprint")) return false;
  const link = extractTaskSections(record.body, ["Product / Safety Link"])[
    "Product / Safety Link"
  ];
  return /\bruntime posture blocker\b/i.test(link ?? "") &&
    /\bProduct\/Safety\b/i.test(link ?? "");
}

function timestamp(record: RepoTaskFullRecord): number {
  const ms = Date.parse(record.updatedAt);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/**
 * Compare two backlog candidates. Lower comes first (higher priority for
 * promotion).
 *
 * Order:
 *   1. priority (p0 < p1 < p2 < p3)
 *   2. generated runtime-posture repair before ordinary work
 *   3. task class (Safety, Product, Platform, Unclassified, Meta)
 *   4. strategic area before fan-out at the same priority/class
 *   5. older `updated_at` before newer (oldest waits longest, gets promoted)
 *   6. id for deterministic ordering at exact ties
 */
export function compareBacklogCandidates(
  a: RepoTaskFullRecord,
  b: RepoTaskFullRecord,
): number {
  const priorityDelta = priorityScore(a.priority) - priorityScore(b.priority);
  if (priorityDelta !== 0) return priorityDelta;

  const runtimeRepairDelta =
    Number(isRuntimePostureRepair(b)) - Number(isRuntimePostureRepair(a));
  if (runtimeRepairDelta !== 0) return runtimeRepairDelta;

  const classDelta = taskClassScore(a.taskClass) - taskClassScore(b.taskClass);
  if (classDelta !== 0) return classDelta;

  const strategicDelta = Number(isStrategic(b)) - Number(isStrategic(a));
  if (strategicDelta !== 0) return strategicDelta;

  const ageDelta = timestamp(a) - timestamp(b);
  if (ageDelta !== 0) return ageDelta;

  return a.id.localeCompare(b.id);
}

export type PromotionCandidateSummary = {
  id: string;
  title: string;
  priority: string;
  area: string;
  taskClass: RepoTaskClass;
  state: "backlog" | "blocked";
  strategic: boolean;
  updatedAt: string;
};

export type PromotionSelection = {
  id: string;
  title: string;
  priority: string;
  area: string;
  taskClass: RepoTaskClass;
  reason: string;
};

export type PromotionRejection = {
  id: string;
  title: string;
  priority: string;
  taskClass: RepoTaskClass;
  state: "backlog" | "blocked";
  reason: string;
};

const ANCHOR_REJECTION_REASON =
  "strategic anchor: implementation lives in sub-slice tasks; anchor never lands in ready/";

export type PromotionRationale = {
  selected: PromotionSelection[];
  rejected: PromotionRejection[];
  candidates: PromotionCandidateSummary[];
  /**
   * Human-readable summary used in the commit message and operator-facing
   * artifacts. Names how many tasks were promoted, why they beat the
   * remaining alternatives, and which higher-priority blockers are still
   * stuck.
   */
  summary: string;
};

function describeCandidate(record: RepoTaskFullRecord): PromotionCandidateSummary {
  return {
    id: record.id,
    title: record.title,
    priority: record.priority,
    area: record.area,
    taskClass: record.taskClass,
    state: record.state === "backlog" ? "backlog" : "blocked",
    strategic: isStrategic(record),
    updatedAt: record.updatedAt,
  };
}

function describeReason(record: RepoTaskFullRecord, rank: number): string {
  const parts: string[] = [];
  parts.push(`rank ${rank + 1}`);
  parts.push(`priority ${record.priority || "unset"}`);
  if (isRuntimePostureRepair(record)) parts.push("runtime posture repair");
  parts.push(`task_class ${record.taskClass}`);
  if (record.area) parts.push(`area ${record.area}`);
  if (isStrategic(record)) parts.push("strategic area");
  parts.push(`updated_at ${record.updatedAt}`);
  return parts.join("; ");
}

/**
 * Build the deterministic promotion rationale for the current backlog. Pure:
 * does not move any files. The caller is responsible for passing the result
 * to `applyPromotion` (which performs the `git mv` via `moveTaskById`).
 */
export function buildPromotionRationale(
  projectDir: string,
  options: { batchLimit?: number } = {},
): PromotionRationale {
  const batchLimit = options.batchLimit ?? PROMOTION_BATCH_LIMIT;
  const records = listFullRepoTasks(projectDir, ["backlog", "blocked"]);
  const waitingById = new Map(
    listRepoTaskDependencyWaits(projectDir, ["backlog", "blocked"]).map((wait) => [
      wait.id,
      wait.waitingOn,
    ]),
  );
  const allBacklog = records
    .filter((record) => record.state === "backlog")
    .sort(compareBacklogCandidates);
  const anchorBacklog = allBacklog.filter((record) => record.anchor);
  const dependencyWaitingBacklog = allBacklog.filter((record) =>
    !record.anchor && waitingById.has(record.id)
  );
  const dependencyClearBacklog = allBacklog.filter((record) =>
    !record.anchor && !waitingById.has(record.id)
  );
  const transitionBlockerById = new Map(
    dependencyClearBacklog.flatMap((record) => {
      const blocker = getRepoTaskStateTransitionBlocker(record, "ready");
      return blocker === null ? [] : [[record.id, blocker] as const];
    }),
  );
  const transitionBlockedBacklog = dependencyClearBacklog.filter((record) =>
    transitionBlockerById.has(record.id)
  );
  const promotableBacklog = dependencyClearBacklog.filter((record) =>
    !transitionBlockerById.has(record.id)
  );
  const blocked = records
    .filter((record) => record.state === "blocked")
    .sort(compareBacklogCandidates);

  const selected = promotableBacklog.slice(0, batchLimit).map((record, index) => ({
    id: record.id,
    title: record.title,
    priority: record.priority,
    area: record.area,
    taskClass: record.taskClass,
    reason: describeReason(record, index),
  }));
  const rejectedBacklog = promotableBacklog.slice(batchLimit).map((record) => ({
    id: record.id,
    title: record.title,
    priority: record.priority,
    taskClass: record.taskClass,
    state: "backlog" as const,
    reason: "lower-ranked backlog candidate",
  }));
  const rejectedAnchors = anchorBacklog.map((record) => ({
    id: record.id,
    title: record.title,
    priority: record.priority,
    taskClass: record.taskClass,
    state: "backlog" as const,
    reason: ANCHOR_REJECTION_REASON,
  }));
  const rejectedDependencyWaiting = dependencyWaitingBacklog.map((record) => ({
    id: record.id,
    title: record.title,
    priority: record.priority,
    taskClass: record.taskClass,
    state: "backlog" as const,
    reason: `waiting on task dependencies: ${waitingById.get(record.id)?.join(", ") ?? ""}`,
  }));
  const rejectedTransitionBlocked = transitionBlockedBacklog.map((record) => ({
    id: record.id,
    title: record.title,
    priority: record.priority,
    taskClass: record.taskClass,
    state: "backlog" as const,
    reason: `cannot enter ready/: ${transitionBlockerById.get(record.id) ?? ""}`,
  }));
  const rejectedBlocked = blocked.map((record) => ({
    id: record.id,
    title: record.title,
    priority: record.priority,
    taskClass: record.taskClass,
    state: "blocked" as const,
    reason: waitingById.has(record.id)
      ? `blocked: waiting on task dependencies ${waitingById.get(record.id)?.join(", ")}`
      : "blocked: cannot be promoted until precondition clears",
  }));

  const candidates = [
    ...allBacklog.map(describeCandidate),
    ...blocked.map(describeCandidate),
  ];

  const summaryLines: string[] = [];
  if (selected.length === 0) {
    summaryLines.push(
      "No backlog tasks were available to promote (the queue is empty or only blocked, anchor, dependency-waiting, or ready-invalid work remains).",
    );
  } else {
    const ids = selected
      .map((s) => `${s.id} (${s.priority || "no-priority"}, ${s.taskClass})`)
      .join(", ");
    summaryLines.push(
      `Promoted ${selected.length} of ${promotableBacklog.length} promotable backlog task(s): ${ids}.`,
    );
    summaryLines.push(
      "Ranked by priority, runtime-posture repair exception, task_class, strategic area, then oldest updated_at; this batch beat the remaining backlog and the higher-priority alternatives are honestly blocked.",
    );
  }
  if (rejectedAnchors.length > 0) {
    const anchorIds = rejectedAnchors.map((r) => r.id).join(", ");
    summaryLines.push(
      `Strategic anchors skipped (never promoted): ${anchorIds}. Their work lands through declared sub-slice tasks.`,
    );
  }
  if (rejectedDependencyWaiting.length > 0) {
    const waitingIds = rejectedDependencyWaiting
      .map((r) => `${r.id} (${r.reason})`)
      .join(", ");
    summaryLines.push(
      `Backlog tasks waiting on hard predecessors skipped: ${waitingIds}.`,
    );
  }
  if (rejectedTransitionBlocked.length > 0) {
    const transitionBlockedIds = rejectedTransitionBlocked
      .map((r) => `${r.id} (${r.reason})`)
      .join(", ");
    summaryLines.push(
      `Backlog tasks not ready-actionable skipped: ${transitionBlockedIds}.`,
    );
  }
  if (rejectedBlocked.length > 0) {
    const blockedIds = rejectedBlocked.map((r) => r.id).join(", ");
    summaryLines.push(
      `Blocked alternatives still stuck: ${blockedIds}. Their preconditions must clear before they can land in ready/.`,
    );
  }

  return {
    selected,
    rejected: [
      ...rejectedBacklog,
      ...rejectedAnchors,
      ...rejectedDependencyWaiting,
      ...rejectedTransitionBlocked,
      ...rejectedBlocked,
    ],
    candidates,
    summary: summaryLines.join("\n"),
  };
}
