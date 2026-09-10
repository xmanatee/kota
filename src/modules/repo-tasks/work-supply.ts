import { dirname } from "node:path";
import { loadConfig } from "#core/config/config.js";
import { DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE } from "#core/daemon/runtime-scope-provider.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import { defineWorkflowBlockingOperation, type WorkflowBlockingOperationHandler } from "#core/workflow/blocking-operation.js";
import { resolveWorkflowConcurrency } from "#core/workflow/concurrency.js";
import { readRunOperationalProjection } from "#core/workflow/run-operational-projection.js";
import { type PublishedRepoTaskQueue, readPublishedRepoTaskQueue } from "./published-task-queue.js";
import {
  type RepoTaskQueueSnapshot,
  selectActionableRepoTasks,
} from "./repo-tasks-domain.js";

export type TaskWorkOwner = {
  taskId: string;
  runId: string;
  state: "queued" | "running" | "integrating" | "waiting" | "needs_attention";
};

/** Repository intent joined with runtime reservations; never an admission decision. */
export type RepoWorkSupply = RepoTaskQueueSnapshot & {
  ownershipAvailable: boolean;
  capacity: number;
  availableTaskIds: string[];
  owners: TaskWorkOwner[];
  runningCount: number;
  queuedCount: number;
  retainedCount: number;
  availableCount: number;
};

export type RepoWorkSupplyInput = {
  workspaceRoot: string;
  scopeRoot: string;
  stateDir: string;
  capacity: number;
};

/** Resolve live daemon authority before crossing a worker boundary. Offline readers supply their state root. */
export function resolveRepoWorkSupplyInput(input: Omit<RepoWorkSupplyInput, "capacity">): RepoWorkSupplyInput {
  const provider = getProviderRegistry()?.get(DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE);
  if (provider) {
    const selected = provider.resolve(deriveDirectoryScopeId(input.scopeRoot));
    if (!selected.ok) throw new Error("Work supply scope is not hosted");
    return {
      ...input,
      stateDir: dirname(selected.runtime.runState.path),
      capacity: selected.runtime.workflowRuntime.getState().concurrency,
    };
  }
  return { ...input, capacity: resolveWorkflowConcurrency(loadConfig(input.scopeRoot).scheduler) };
}

export function inspectRepoWorkSupply(
  input: RepoWorkSupplyInput,
  published: PublishedRepoTaskQueue = readPublishedRepoTaskQueue(input.workspaceRoot),
): RepoWorkSupply {
  const { queue, tasks } = published;
  const runtime = readRunOperationalProjection(input);
  const capacity = input.capacity;
  const owners = runtime.runs.flatMap((run): TaskWorkOwner[] => {
    if (run.state === "succeeded" || run.state === "failed" || run.state === "cancelled") return [];
    const state = run.state;
    return run.resources.filter((key) => key.startsWith("task:")).map((key) => ({
      taskId: key.slice("task:".length), runId: run.runId, state,
    }));
  });
  const owned = new Set(owners.map((owner) => owner.taskId));
  const availableTaskIds = runtime.available
    ? selectActionableRepoTasks(tasks)
      .filter((task) => !owned.has(task.id)).map((task) => task.id)
    : [];
  const retained = new Set(owners.filter((owner) => owner.state === "waiting" || owner.state === "needs_attention").map((owner) => owner.taskId));
  const running = new Set(owners.filter((owner) => !retained.has(owner.taskId) &&
    (owner.state === "running" || owner.state === "integrating")).map((owner) => owner.taskId));
  const queued = new Set(owners.filter((owner) => !retained.has(owner.taskId) && !running.has(owner.taskId) &&
    owner.state === "queued").map((owner) => owner.taskId));
  // A queued contender behind retained ownership is not another useful work item.
  const rank = (owner: TaskWorkOwner) => retained.has(owner.taskId) &&
    (owner.state === "waiting" || owner.state === "needs_attention") ? 0 : owner.state === "queued" ? 2 : 1;
  owners.sort((a, b) => rank(a) - rank(b) || a.runId.localeCompare(b.runId));
  const dispatchableCount = availableTaskIds.length + queue.inboxCount;
  return {
    ...queue,
    ownershipAvailable: runtime.available,
    capacity,
    availableTaskIds,
    owners,
    runningCount: running.size,
    queuedCount: queued.size,
    retainedCount: retained.size,
    availableCount: availableTaskIds.length,
    dispatchableCount,
    hasDispatchableWork: runtime.available && dispatchableCount > 0,
  };
}

export const runRepoWorkSupplyOperation: WorkflowBlockingOperationHandler<RepoWorkSupplyInput, RepoWorkSupply> =
  (input) => inspectRepoWorkSupply(input);

export const repoWorkSupplyOperation = defineWorkflowBlockingOperation<RepoWorkSupplyInput, RepoWorkSupply>(
  import.meta.url, "runRepoWorkSupplyOperation",
);
