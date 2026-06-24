import { parseBlockedPrecondition } from "#modules/repo-tasks/blocked-precondition.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { BlockerClassMix, BlockerKind } from "./aggregate-types.js";

export function buildBlockerMix(
  allTasks: RepoTaskFullRecord[],
): BlockerClassMix {
  const blocked = allTasks.filter((t) => t.state === "blocked");
  const counts = new Map<BlockerKind, number>();
  for (const task of blocked) {
    const parsed = parseBlockedPrecondition(task.body);
    const kind: BlockerKind = parsed.ok
      ? parsed.precondition.kind
      : parsed.error === "missing-section"
        ? "missing-section"
        : "malformed";
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const order = new Map<BlockerKind, number>([
    ["task-done", 0],
    ["capability-installed", 1],
    ["owner-decision", 2],
    ["operator-capture", 3],
    ["missing-section", 4],
    ["malformed", 5],
  ]);
  return {
    totalBlocked: blocked.length,
    byKind: [...counts.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => (order.get(a.kind) ?? 9) - (order.get(b.kind) ?? 9)),
  };
}
