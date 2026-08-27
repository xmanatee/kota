/**
 * Adapters that wrap each first-party store's removal helper into a
 * `RetractContributor`. The adapters are owned by the retract module so
 * adding a new contributor is a registration here, not an edit across
 * every consumer.
 *
 * Each adapter delegates to the store's existing in-process removal API:
 *
 * - memory    — `MemoryProvider.delete(id)` returns whether the id existed.
 * - knowledge — `KnowledgeProvider.delete(slug)` deletes the slug-indexed
 *               file. The seam returns `not_found` if the slug is unknown.
 * - tasks     — the repo-tasks mutation boundary serializes the state change
 *               against any workflow owning `task:<id>`. The contributor
 *               never deletes the file or bypasses the canonical task mutation path.
 * - inbox     — the repo-tasks domain identity-checks, removes, and stages the
 *               resolved path through its descriptor-anchored boundary.
 *
 * Errors from the underlying writer (filesystem failure, git failure,
 * unexpected state) propagate verbatim so the seam can surface them as the
 * typed `contributor_failed` arm.
 */
import type {
  KnowledgeProvider,
  MemoryProvider,
} from "#core/modules/provider-types.js";
import {
	mutateRepoTask,
	type RepoTaskMutationTarget,
	type RepoTaskRuntimeSandboxTarget,
} from "#modules/repo-tasks/repo-task-mutation-boundary.js";
import type {
  InboxRetractContributor,
  KnowledgeRetractContributor,
  MemoryRetractContributor,
  RetractContributorResult,
  RetractScopeContext,
  TasksRetractContributor,
} from "./retract-types.js";

function requireScope(
  scope: RetractScopeContext | undefined,
): RetractScopeContext {
  if (!scope) {
    throw new Error("Retract contributor requires a scope context");
  }
  return scope;
}

function retractMemory(
  provider: MemoryProvider,
  id: string,
): RetractContributorResult {
  const removed = provider.delete(id);
  if (!removed) {
    return { kind: "not_found", identifier: id };
  }
  return {
    kind: "removed",
    record: { target: "memory", recordId: id },
  };
}

function retractKnowledge(
  provider: KnowledgeProvider,
  slug: string,
): RetractContributorResult {
  const removed = provider.delete(slug);
  if (!removed) {
    return { kind: "not_found", identifier: slug };
  }
  return {
    kind: "removed",
    record: { target: "knowledge", recordId: slug },
  };
}

async function retractTasks(
	target: RepoTaskMutationTarget,
  id: string,
): Promise<RetractContributorResult> {
  const result = await mutateRepoTask(target, {
    kind: "move",
    id,
    state: "dropped",
  });
  if (!result.ok && result.reason === "not_found") {
    return { kind: "not_found", identifier: id };
  }
  if (!result.ok) {
    throw new Error(`Cannot retract task "${id}": ${result.reason}`);
  }
  return {
    kind: "removed",
    record: {
      target: "tasks",
      recordId: result.id,
      previousPath: result.previousPath,
      path: result.path,
      toState: "dropped",
    },
  };
}

async function retractInbox(
	target: RepoTaskMutationTarget,
  path: string,
): Promise<RetractContributorResult> {
  const result = await mutateRepoTask(target, { kind: "retract-inbox", path });
  if (!result.ok) {
    return { kind: "not_found", identifier: path };
  }
  return {
    kind: "removed",
    record: { target: "inbox", recordId: result.recordId, path: result.path },
  };
}

export function createMemoryContributor(
  provider: MemoryProvider,
): MemoryRetractContributor {
  return {
    target: "memory",
    async retract({ id }): Promise<RetractContributorResult> {
      return retractMemory(provider, id);
    },
  };
}

export function createScopeMemoryContributor(): MemoryRetractContributor {
  return {
    target: "memory",
    async retract({ id, scope }): Promise<RetractContributorResult> {
      return retractMemory(requireScope(scope).memory, id);
    },
  };
}

export function createKnowledgeContributor(
  provider: KnowledgeProvider,
): KnowledgeRetractContributor {
  return {
    target: "knowledge",
    async retract({ slug }): Promise<RetractContributorResult> {
      return retractKnowledge(provider, slug);
    },
  };
}

export function createScopeKnowledgeContributor(): KnowledgeRetractContributor {
  return {
    target: "knowledge",
    async retract({ slug, scope }): Promise<RetractContributorResult> {
      return retractKnowledge(requireScope(scope).knowledge, slug);
    },
  };
}

export function createTasksContributor(
	target: RepoTaskRuntimeSandboxTarget,
): TasksRetractContributor {
  return {
    target: "tasks",
    async retract({ id }): Promise<RetractContributorResult> {
		return retractTasks(target, id);
    },
  };
}

export function createScopeTasksContributor(): TasksRetractContributor {
  return {
    target: "tasks",
    async retract({ id, scope }): Promise<RetractContributorResult> {
        const { scopeId } = requireScope(scope);
		return retractTasks(
            { authority: "canonical", scopeId },
			id,
		);
    },
  };
}

export function createInboxContributor(
	target: RepoTaskRuntimeSandboxTarget,
): InboxRetractContributor {
  return {
    target: "inbox",
    async retract({ path }): Promise<RetractContributorResult> {
		return retractInbox(target, path);
    },
  };
}

export function createScopeInboxContributor(): InboxRetractContributor {
  return {
    target: "inbox",
    async retract({ path, scope }): Promise<RetractContributorResult> {
        const { scopeId } = requireScope(scope);
		return retractInbox(
            { authority: "canonical", scopeId },
			path,
		);
    },
  };
}
