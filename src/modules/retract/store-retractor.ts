import {
  mutateRepoTask,
  type RepoTaskMutationTarget,
} from "#modules/repo-tasks/repo-task-mutation-boundary.js";
import type { RetractRequest, RetractResult } from "./client.js";
import type { RetractScopeContext } from "./retract-types.js";

function canonicalTarget(scope: RetractScopeContext): RepoTaskMutationTarget {
  return {
    authority: "canonical",
    scopeId: scope.scopeId,
    getDispatcher: scope.getWorkflowDispatcher,
  };
}

/** Maps one selected target into its owning store's canonical removal operation. */
export async function retractTarget({
  request,
  scope,
}: {
  request: RetractRequest;
  scope: RetractScopeContext;
}): Promise<RetractResult> {
  const { target, identifier } = request;
  switch (target) {
    case "memory":
      return {
        target,
        identifier,
        ...(scope.memory.delete(identifier)
          ? { ok: true as const }
          : { ok: false as const, reason: "not_found" as const }),
      };
    case "knowledge":
      return {
        target,
        identifier,
        ...(scope.knowledge.delete(identifier)
          ? { ok: true as const }
          : { ok: false as const, reason: "not_found" as const }),
      };
    case "tasks": {
      const result = await mutateRepoTask(canonicalTarget(scope), {
        kind: "move",
        id: identifier,
        state: "dropped",
      });
      if (result.ok) {
        if (result.toState !== "dropped") {
          throw new Error(
            `Task retraction returned unexpected state ${result.toState}`,
          );
        }
        return { target, identifier, ...result };
      }
      return { target, identifier, ...result };
    }
    case "inbox": {
      const result = await mutateRepoTask(canonicalTarget(scope), {
        kind: "retract-inbox",
        path: identifier,
      });
      return { target, identifier, ...result };
    }
  }
}
