import {
  taskClaimContentDigest,
  taskClaimContractDigest,
} from "#modules/autonomy/task-claim-task-binding.js";
import type { TaskClaim } from "#modules/autonomy/task-claims.js";

export const FAILED_RUN_ID = "run-failed-builder";
export const CLAIM_SNAPSHOT = {
  dev: 1,
  ino: 1,
  size: 1,
  mtimeMs: 1,
  ctimeMs: 1,
};
export const TASK_MARKDOWN =
  "---\nid: task-fixture\n---\n\n## Problem\n\nCanonical task intent.\n";

export function claimedTaskFile(taskId: string) {
  return {
    path: `data/tasks/ready/${taskId}.md`,
    snapshot: { ...CLAIM_SNAPSHOT },
  };
}

export function matchingPendingClaim(
  taskId: string,
  overrides: Partial<TaskClaim> = {},
): TaskClaim {
  return {
    schemaVersion: 2,
    taskId,
    taskState: "ready",
    taskFile: claimedTaskFile(taskId),
    taskContentDigest: taskClaimContentDigest(TASK_MARKDOWN),
    taskContractDigest: taskClaimContractDigest(TASK_MARKDOWN),
    runId: FAILED_RUN_ID,
    workflowId: "builder",
    owner: "workflow:builder",
    workspaceDir: "/tmp/builder-worktree",
    branch: `kota/task/${taskId}`,
    baseCommit: "base-commit",
    leaseMs: 60_000,
    leaseAcquiredAt: "2026-04-10T20:00:00Z",
    leaseExpiresAt: "2026-04-11T03:00:00Z",
    createdAt: "2026-04-10T20:00:00Z",
    updatedAt: "2026-04-10T21:00:00Z",
    status: "pending-decomposition",
    evidence: "builder failed without stageable progress",
    ...overrides,
  };
}
