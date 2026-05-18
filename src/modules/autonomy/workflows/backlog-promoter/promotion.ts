import {
  listFullRepoTasks,
  listRepoTaskDependencyWaits,
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
 * tie-breaker after priority and age so architecture/autonomy/core work
 * surfaces above narrower fan-out at the same priority and age.
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

function priorityScore(priority: string): number {
  const rank = PRIORITY_RANK[priority];
  // Tasks with an unrecognized priority sort below p3 so they only get
  // promoted when nothing else is available; the validator already rejects
  // missing/invalid priorities, but we stay defensive at this seam.
  return rank ?? 99;
}

function isStrategic(record: RepoTaskFullRecord): boolean {
  return STRATEGIC_AREAS.has(record.area);
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
 *   2. strategic area before fan-out at the same priority
 *   3. older `updated_at` before newer (oldest waits longest, gets promoted)
 *   4. id for deterministic ordering at exact ties
 */
export function compareBacklogCandidates(
  a: RepoTaskFullRecord,
  b: RepoTaskFullRecord,
): number {
  const priorityDelta = priorityScore(a.priority) - priorityScore(b.priority);
  if (priorityDelta !== 0) return priorityDelta;

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
  state: "backlog" | "blocked";
  strategic: boolean;
  updatedAt: string;
};

export type PromotionSelection = {
  id: string;
  title: string;
  priority: string;
  area: string;
  reason: string;
};

export type PromotionRejection = {
  id: string;
  title: string;
  priority: string;
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
    state: record.state === "backlog" ? "backlog" : "blocked",
    strategic: isStrategic(record),
    updatedAt: record.updatedAt,
  };
}

function describeReason(record: RepoTaskFullRecord, rank: number): string {
  const parts: string[] = [];
  parts.push(`rank ${rank + 1}`);
  parts.push(`priority ${record.priority || "unset"}`);
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
  const promotableBacklog = allBacklog.filter((record) =>
    !record.anchor && !waitingById.has(record.id)
  );
  const blocked = records
    .filter((record) => record.state === "blocked")
    .sort(compareBacklogCandidates);

  const selected = promotableBacklog.slice(0, batchLimit).map((record, index) => ({
    id: record.id,
    title: record.title,
    priority: record.priority,
    area: record.area,
    reason: describeReason(record, index),
  }));
  const rejectedBacklog = promotableBacklog.slice(batchLimit).map((record) => ({
    id: record.id,
    title: record.title,
    priority: record.priority,
    state: "backlog" as const,
    reason: "lower-ranked backlog candidate",
  }));
  const rejectedAnchors = anchorBacklog.map((record) => ({
    id: record.id,
    title: record.title,
    priority: record.priority,
    state: "backlog" as const,
    reason: ANCHOR_REJECTION_REASON,
  }));
  const rejectedDependencyWaiting = dependencyWaitingBacklog.map((record) => ({
    id: record.id,
    title: record.title,
    priority: record.priority,
    state: "backlog" as const,
    reason: `waiting on task dependencies: ${waitingById.get(record.id)?.join(", ") ?? ""}`,
  }));
  const rejectedBlocked = blocked.map((record) => ({
    id: record.id,
    title: record.title,
    priority: record.priority,
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
      "No backlog tasks were available to promote (the queue is empty or only blocked/anchor work remains).",
    );
  } else {
    const ids = selected.map((s) => `${s.id} (${s.priority || "no-priority"})`).join(", ");
    summaryLines.push(
      `Promoted ${selected.length} of ${promotableBacklog.length} promotable backlog task(s): ${ids}.`,
    );
    summaryLines.push(
      "Ranked by priority then strategic area then oldest updated_at; this batch beat the remaining backlog and the higher-priority alternatives are honestly blocked.",
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
      ...rejectedBlocked,
    ],
    candidates,
    summary: summaryLines.join("\n"),
  };
}
