import {
  compareAutonomyTasks,
  describeAutonomyTaskRank,
} from "#modules/autonomy/task-ranking.js";
import {
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

export function compareBacklogCandidates(
  a: RepoTaskFullRecord,
  b: RepoTaskFullRecord,
): number {
  return compareAutonomyTasks(a, b);
}

export type PromotionCandidateSummary = {
  id: string;
  title: string;
  priority: string;
  area: string;
  taskClass: RepoTaskClass;
  state: "backlog" | "blocked" | "ready" | "doing";
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
  frontier: {
    incumbentTaskId: string | null;
    improved: boolean;
    reason: string;
  };
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
    state: record.state as PromotionCandidateSummary["state"],
    updatedAt: record.updatedAt,
  };
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
  const actionable = listFullRepoTasks(projectDir, ["ready", "doing"])
    .sort(compareAutonomyTasks);
  const incumbent = actionable.find((record) => record.state === "ready") ?? null;
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

  const frontierImprovements = incumbent === null
    ? promotableBacklog
    : promotableBacklog.filter(
      (record) => compareAutonomyTasks(record, incumbent) < 0,
    );
  const selected = frontierImprovements.slice(0, batchLimit).map((record, index) => ({
    id: record.id,
    title: record.title,
    priority: record.priority,
    area: record.area,
    taskClass: record.taskClass,
    reason: describeAutonomyTaskRank(record, index),
  }));
  const selectedIds = new Set(selected.map((record) => record.id));
  const rejectedBacklog = promotableBacklog
    .filter((record) => !selectedIds.has(record.id))
    .map((record) => ({
      id: record.id,
      title: record.title,
      priority: record.priority,
      taskClass: record.taskClass,
      state: "backlog" as const,
      reason: incumbent && compareAutonomyTasks(record, incumbent) >= 0
        ? `does not outrank ready frontier ${incumbent.id}`
        : "lower-ranked backlog candidate",
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
    ...actionable.map(describeCandidate),
    ...allBacklog.map(describeCandidate),
    ...blocked.map(describeCandidate),
  ];

  const summaryLines: string[] = [];
  if (selected.length === 0) {
    summaryLines.push(incumbent
      ? `No backlog task outranks the current ready frontier ${incumbent.id}.`
      : "No backlog tasks were available to promote (the queue is empty or only blocked, anchor, dependency-waiting, or ready-invalid work remains).",
    );
  } else {
    const ids = selected
      .map((s) => `${s.id} (${s.priority || "no-priority"}, ${s.taskClass})`)
      .join(", ");
    summaryLines.push(
      `Promoted ${selected.length} of ${frontierImprovements.length} frontier-improving backlog task(s): ${ids}.`,
    );
    summaryLines.push(
      "Ranked by authored priority, then age and task id; task labels and prose do not gate execution.",
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
    frontier: {
      incumbentTaskId: incumbent?.id ?? null,
      improved: selected.length > 0,
      reason: selected.length > 0
        ? `${selected[0]!.id} outranks ${incumbent?.id ?? "an empty ready frontier"}`
        : incumbent
          ? `no promotable backlog task outranks ${incumbent.id}`
          : "no promotable backlog task exists",
    },
    summary: summaryLines.join("\n"),
  };
}
