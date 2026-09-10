import { readWorkingTextTree } from "#core/util/repository-tree.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import {
  BUILDER_TASK_EVENT,
  listBuilderTaskDispatches,
  readBuilderTaskPayload,
} from "#modules/autonomy/workflows/builder/task-contract.js";
import { listRepoTasksFromTree } from "#modules/repo-tasks/repo-tasks-domain.js";
import { assertTaskQueueValid } from "#modules/repo-tasks/task-queue-validation.js";

export type OwnershipResolution =
  | { kind: "superseded-task"; reason: string }
  | {
      kind: "owned-task";
      task: {
        id: string;
        path: string;
        markdown: string;
        digest: string;
      };
    };

/**
 * Resolve a failed builder's immutable trigger contract against the current
 * repository snapshot. Durable run metadata and the runtime-owned task
 * resource replace the former task-claim side channel.
 */
export function resolveDecompositionOwnership(
  workspaceRoot: string,
  metadata: WorkflowRunMetadata,
): OwnershipResolution {
  if (
    metadata.workflow !== "builder" ||
    metadata.status !== "failed" ||
    metadata.trigger.event !== BUILDER_TASK_EVENT
  ) {
    throw new Error(
      `Decomposition ownership requires a failed builder run triggered by ${BUILDER_TASK_EVENT}`,
    );
  }
  const expected = readBuilderTaskPayload(metadata.trigger.payload);
  // Authorize and return the same pinned working bytes, including retained edits.
  const tree = readWorkingTextTree(workspaceRoot);
  assertTaskQueueValid(workspaceRoot, tree);
  const current = listBuilderTaskDispatches(workspaceRoot, {
    tasks: listRepoTasksFromTree(tree),
  }).find(
    (candidate) => candidate.taskId === expected.taskId,
  );
  if (current === undefined) {
    return {
      kind: "superseded-task",
      reason: `Builder task ${expected.taskId} is no longer dependency-clear and actionable`,
    };
  }
  if (
    current.taskPath !== expected.taskPath ||
    current.taskState !== expected.taskState ||
    current.taskDigest !== expected.taskDigest ||
    current.idempotencyKey !== expected.idempotencyKey
  ) {
    return {
      kind: "superseded-task",
      reason: `Builder task ${expected.taskId} changed after the failed run was admitted`,
    };
  }

  return {
    kind: "owned-task",
    task: {
      id: current.taskId,
      path: current.taskPath,
      markdown: tree.read(current.taskPath),
      digest: current.taskDigest,
    },
  };
}
