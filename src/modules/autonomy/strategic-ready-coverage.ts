import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
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

export function inspectClaimAwareStrategicReadyCoverage(input: {
  projectDir: string;
  nowIso?: string;
}): string {
  return assertClaimAwareStrategicReadyCoverage(
    input.projectDir,
    input.nowIso === undefined ? new Date() : new Date(input.nowIso),
  );
}

export const claimAwareStrategicReadyCoverageOperation =
  defineWorkflowBlockingOperation<
    { projectDir: string; nowIso?: string },
    string
  >(import.meta.url, "inspectClaimAwareStrategicReadyCoverage");
