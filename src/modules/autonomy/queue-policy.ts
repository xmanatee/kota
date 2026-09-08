import {
  isThinDispatchableQueue,
  type RepoTaskQueueSnapshot,
} from "#modules/repo-tasks/repo-tasks-domain.js";

/** Queue shape is independent of the scope's authority to execute its tasks. */
export function assessAutonomyQueue(queue: RepoTaskQueueSnapshot): {
  dependencyBlocked: boolean;
  empty: boolean;
  thin: boolean;
  explorationEligible: boolean;
} {
  const dependencyBlocked = queue.dependencyBlockedTasks.length > 0;
  const empty = !queue.hasDispatchableWork && !dependencyBlocked;
  const thin = isThinDispatchableQueue(queue);
  return {
    dependencyBlocked,
    empty,
    thin,
    explorationEligible: !dependencyBlocked && (empty || thin),
  };
}
