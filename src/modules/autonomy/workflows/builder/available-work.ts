import type { ScopePolicySnapshot } from "#core/daemon/scope-policy-authority.js";
import type { WorkflowAvailableWorkResolver } from "#core/workflow/types.js";
import { type PublishedRepoTaskQueue, readPublishedRepoTaskQueue } from "#modules/repo-tasks/published-task-queue.js";
import { inspectRepoWorkSupply, type RepoWorkSupply } from "#modules/repo-tasks/work-supply.js";
import { resolveScopeImprovementAuthority } from "../scope-improver/scope-improvement-authority.js";
import { BUILDER_TASK_EVENT, listBuilderTaskDispatches } from "./task-contract.js";

/** Idle routing and continuation handoffs use the same published supply and write authority. */
export function listAvailableBuilderTasks(input: {
  scopeRoot: string;
  stateDir: string;
  scopePolicySnapshot: ScopePolicySnapshot | null;
  published: PublishedRepoTaskQueue;
  supply: RepoWorkSupply;
}) {
  if (input.scopePolicySnapshot === null) return [];
  try {
    if (resolveScopeImprovementAuthority({
      scopeRoot: input.scopeRoot, stateDir: input.stateDir,
      policy: input.scopePolicySnapshot.policy,
    }).builder !== "enabled") return [];
  } catch {
    // Malformed scope configuration cannot authorize autonomous builder admission.
    return [];
  }
  const available = new Set(input.supply.availableTaskIds);
  return listBuilderTaskDispatches(input.scopeRoot, input.published)
    .filter((task) => available.has(task.taskId));
}

export const resolveAvailableBuilderWork: WorkflowAvailableWorkResolver = (input) => {
  if (!input.resources.some((resource) => resource.startsWith("task:"))) return [];
  const published = readPublishedRepoTaskQueue(input.scopeRoot);
  const supply = inspectRepoWorkSupply({
    workspaceRoot: input.scopeRoot, scopeRoot: input.scopeRoot,
    stateDir: input.runtimeStateDir, capacity: input.capacity,
  }, published);
  if (!supply.ownershipAvailable) throw new Error("Continuation work supply ownership is unavailable");
  const resources = new Set(input.resources);
  return listAvailableBuilderTasks({ ...input, published, supply })
    .filter((task) => resources.has(`task:${task.taskId}`))
    .map((task) => ({
      event: BUILDER_TASK_EVENT, schemaRef: null,
      payload: { ...task, dependsOn: [...task.dependsOn], scopeId: input.scopeId },
    }));
};
