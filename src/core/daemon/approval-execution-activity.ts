import type { ApprovalQueue } from "./approval-queue.js";

const activeByQueue = new WeakMap<ApprovalQueue, Map<string, number>>();

/** Track approval preflight, execution, and lease cleanup for scope drain. */
export function beginApprovalExecutionActivity(
  queue: ApprovalQueue,
  approvalIds: readonly string[],
): () => void {
  const counts = activeByQueue.get(queue) ?? new Map<string, number>();
  activeByQueue.set(queue, counts);
  const ids = [...new Set(approvalIds)];
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    for (const id of ids) {
      const count = counts.get(id);
      if (count === undefined || count <= 1) counts.delete(id);
      else counts.set(id, count - 1);
    }
    if (counts.size === 0) activeByQueue.delete(queue);
  };
}

export function listActiveApprovalExecutionIds(queue: ApprovalQueue): string[] {
  return [...(activeByQueue.get(queue)?.keys() ?? [])].sort();
}
