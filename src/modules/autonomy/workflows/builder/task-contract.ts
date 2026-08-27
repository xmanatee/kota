import { createHash } from "node:crypto";
import { join } from "node:path";
import type { AutonomyQueueAvailableEvent } from "#core/events/event-bus-runtime-events.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import type {
  WorkflowPostReconcileInvariant,
  WorkflowResourceInput,
} from "#core/workflow/types.js";
import type { TaskReviewContract } from "#modules/autonomy/task-review-target.js";
import {
  listFullRepoTasks,
  type RepoTaskFullRecord,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { findUnfinishedTaskDependencies } from "#modules/repo-tasks/task-dependencies.js";

export const BUILDER_TASK_EVENT = "autonomy.queue.available";

export type BuilderTaskIdentity = Readonly<{
  taskId: string;
  taskPath: string;
  taskState: "open";
  taskDigest: string;
  idempotencyKey: string;
}>;

export type BuilderTaskReviewContract = TaskReviewContract;

export type BuilderTaskDispatchPayload = Omit<
  AutonomyQueueAvailableEvent,
  "scopeId"
>;

export type BuilderTaskTarget = Readonly<{
  actionable: boolean;
  taskId: string;
  taskPath: string;
  taskState: string;
  taskDigest: string;
  reason: string | null;
}>;

const PRIORITY_ORDER = new Map([
  ["p0", 0],
  ["p1", 1],
  ["p2", 2],
  ["p3", 3],
]);
const TASK_ID_PATTERN = /^task-[a-z0-9][a-z0-9-]*$/;
const TASK_DIGEST_PATTERN = /^[a-f0-9]{64}$/;

function taskPath(task: Pick<RepoTaskFullRecord, "id" | "state">): string {
  return join("data", "tasks", `${task.id}.md`);
}

function digestTask(task: RepoTaskFullRecord): string {
  const contract = {
    id: task.id,
    title: task.title,
    state: task.state,
    priority: task.priority,
    body: task.body,
    dependsOn: [...task.dependsOn].sort(),
  };
  return createHash("sha256").update(JSON.stringify(contract)).digest("hex");
}

function payloadFor(task: RepoTaskFullRecord): BuilderTaskDispatchPayload {
  if (task.state !== "open") {
    throw new Error(`Task "${task.id}" is not actionable`);
  }
  const taskDigest = digestTask(task);
  return Object.freeze({
    taskId: task.id,
    taskPath: taskPath(task),
    taskState: task.state,
    taskDigest,
    title: task.title,
    priority: task.priority!,
    dependsOn: Object.freeze([...task.dependsOn]),
    idempotencyKey: `builder:${task.id}:${taskDigest}`,
  });
}

export function listBuilderTaskDispatches(
  workspaceRoot: string,
): BuilderTaskDispatchPayload[] {
  const allTasks = listFullRepoTasks(workspaceRoot);
  const stateByTaskId = new Map(allTasks.map((task) => [task.id, task.state]));
  return allTasks
    .filter(
      (task) =>
        task.state === "open" &&
        findUnfinishedTaskDependencies(task.dependsOn, stateByTaskId).length === 0,
    )
    .sort((left, right) => {
      const priority =
        (PRIORITY_ORDER.get(left.priority!) ?? Number.MAX_SAFE_INTEGER) -
        (PRIORITY_ORDER.get(right.priority!) ?? Number.MAX_SAFE_INTEGER);
      return priority !== 0 ? priority : left.id.localeCompare(right.id);
    })
    .map(payloadFor);
}

export function readBuilderTaskPayload(
  payload: Record<string, unknown>,
): BuilderTaskIdentity {
  const dispatch = payload as Partial<BuilderTaskIdentity>;
  if (
    typeof dispatch.taskId !== "string" ||
    !TASK_ID_PATTERN.test(dispatch.taskId) ||
    typeof dispatch.taskPath !== "string" ||
    dispatch.taskState !== "open" ||
    dispatch.taskPath !== taskPath({ id: dispatch.taskId, state: dispatch.taskState }) ||
    typeof dispatch.taskDigest !== "string" ||
    !TASK_DIGEST_PATTERN.test(dispatch.taskDigest) ||
    dispatch.idempotencyKey !==
      `builder:${dispatch.taskId}:${dispatch.taskDigest}`
  ) {
    throw new Error("Builder trigger is missing its immutable task contract");
  }
  return {
    taskId: dispatch.taskId,
    taskPath: dispatch.taskPath,
    taskState: dispatch.taskState,
    taskDigest: dispatch.taskDigest,
    idempotencyKey: dispatch.idempotencyKey,
  };
}

export function readBuilderTaskReviewContract(
  payload: Record<string, unknown>,
): BuilderTaskReviewContract {
  const { taskId, taskPath } = readBuilderTaskPayload(payload);
  return Object.freeze({ taskId, taskPath });
}

export function inspectBuilderTaskTarget(input: {
  workspaceRoot: string;
  payload: Record<string, unknown>;
}): BuilderTaskTarget {
  const expected = readBuilderTaskPayload(input.payload);
  const current = listBuilderTaskDispatches(input.workspaceRoot).find(
    (candidate) => candidate.taskId === expected.taskId,
  );
  if (!current) {
    return {
      actionable: false,
      taskId: expected.taskId,
      taskPath: expected.taskPath,
      taskState: "unavailable",
      taskDigest: expected.taskDigest,
      reason: "task is no longer dependency-clear and actionable",
    };
  }
  if (
    current.taskDigest !== expected.taskDigest ||
    current.taskPath !== expected.taskPath ||
    current.idempotencyKey !== expected.idempotencyKey
  ) {
    return {
      actionable: false,
      taskId: expected.taskId,
      taskPath: current.taskPath,
      taskState: current.taskState,
      taskDigest: current.taskDigest,
      reason: "task contract changed after dispatch",
    };
  }
  return {
    actionable: true,
    taskId: current.taskId,
    taskPath: current.taskPath,
    taskState: current.taskState,
    taskDigest: current.taskDigest,
    reason: null,
  };
}

export const verifyBuilderTaskContractAfterReconcile: WorkflowPostReconcileInvariant =
  (input) => {
    input.signal.throwIfAborted();
    if (input.trigger.event !== BUILDER_TASK_EVENT) {
      return {
        satisfied: false,
        reason: `Builder integration requires ${BUILDER_TASK_EVENT}`,
      };
    }
    const target = inspectBuilderTaskTarget({
      workspaceRoot: input.repoRoot,
      payload: input.trigger.payload,
    });
    return target.actionable
      ? { satisfied: true }
      : {
          satisfied: false,
          reason: `Builder task ${target.taskId} no longer matches its admitted source contract: ${target.reason}`,
        };
  };

export const inspectBuilderTaskTargetOperation = defineWorkflowBlockingOperation<
  Parameters<typeof inspectBuilderTaskTarget>[0],
  BuilderTaskTarget
>(import.meta.url, "inspectBuilderTaskTarget");

export function builderTaskResources(input: WorkflowResourceInput): readonly string[] {
  return [`task:${readBuilderTaskPayload(input.trigger.payload).taskId}`];
}
