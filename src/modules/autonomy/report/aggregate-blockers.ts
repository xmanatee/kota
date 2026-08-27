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
    ["capability-installed", 0],
    ["owner-decision", 1],
    ["operator-capture", 2],
    ["missing-section", 3],
    ["malformed", 4],
  ]);
  return {
    totalBlocked: blocked.length,
    byKind: [...counts.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => (order.get(a.kind) ?? 9) - (order.get(b.kind) ?? 9)),
  };
}
