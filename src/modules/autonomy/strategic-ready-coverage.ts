import {
  assertStrategicReadyCoverage,
  hasStrategicReadyCoverageGap,
  type StrategicReadyCoverageOptions,
} from "#modules/repo-tasks/task-queue-validation.js";
import {
  type ClaimAwareRepoTaskQueueSnapshot,
  getClaimAwareRepoTaskQueueSnapshot,
} from "./queue-availability.js";

export function strategicReadyCoverageOptionsForClaimAwareQueue(
  queue: Pick<ClaimAwareRepoTaskQueueSnapshot, "claimBlockedTasks">,
): StrategicReadyCoverageOptions {
  return {
    excludedTaskIds: queue.claimBlockedTasks.map((task) => task.id),
  };
}

export function hasClaimAwareStrategicReadyCoverageGapForQueue(
  projectDir: string,
  queue: Pick<ClaimAwareRepoTaskQueueSnapshot, "claimBlockedTasks">,
): boolean {
  return hasStrategicReadyCoverageGap(
    projectDir,
    strategicReadyCoverageOptionsForClaimAwareQueue(queue),
  );
}

export function hasClaimAwareStrategicReadyCoverageGap(
  projectDir: string,
  now: Date = new Date(),
): boolean {
  const queue = getClaimAwareRepoTaskQueueSnapshot(projectDir, now);
  return hasClaimAwareStrategicReadyCoverageGapForQueue(projectDir, queue);
}

export function assertClaimAwareStrategicReadyCoverage(
  projectDir: string,
  now: Date = new Date(),
): string {
  const queue = getClaimAwareRepoTaskQueueSnapshot(projectDir, now);
  return assertStrategicReadyCoverage(
    projectDir,
    strategicReadyCoverageOptionsForClaimAwareQueue(queue),
  );
}
