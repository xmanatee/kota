import type { RepoWorkSupply } from "#modules/repo-tasks/work-supply.js";

/** A reserve of one capacity-sized batch refills workers as current runs finish. */
export function assessAutonomyQueue(queue: RepoWorkSupply) {
  const dependencyBlocked = queue.dependencyBlockedTasks.length > 0;
  const empty = queue.ownershipAvailable && queue.dispatchableCount === 0;
  const lowWater = queue.capacity;
  const thin = queue.ownershipAvailable && queue.inboxCount === 0 &&
    queue.availableCount > 0 && queue.availableCount <= lowWater;
  return {
    dependencyBlocked,
    empty,
    thin,
    lowWater,
    explorationEligible: empty || thin,
    reason: !queue.ownershipAvailable
      ? "runtime ownership is unavailable"
      : `${queue.availableCount} unclaimed runnable tasks; reserve target ${lowWater}; ` +
        `${queue.runningCount} running, ${queue.queuedCount} queued, ${queue.retainedCount} retained; ` +
        `${queue.dependencyBlockedTasks.length} dependency waits, ${queue.counts.blocked} external blocks`,
  };
}
