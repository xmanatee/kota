import {
  getHistoryProvider,
  getKnowledgeProvider,
  getMemoryProvider,
  getRepoTasksProvider,
} from "#core/modules/provider-registry.js";
import { createHistoryScopeStores } from "#modules/history/scope.js";
import { createKnowledgeScopeStores } from "#modules/knowledge/scope.js";
import { createMemoryScopeStores } from "#modules/memory/scope.js";
import { createRepoTasksScopeStores } from "#modules/repo-tasks/scope.js";
import type { RecallScopeContext } from "./recall-types.js";

export type ResolveRecallScopeContext = (
  scopeId: string | null | undefined,
) => RecallScopeContext | { error: "unknown_scope"; scopeId: string };

export function createRecallScopeContextResolver(
  defaultScopeRoot: string,
): ResolveRecallScopeContext {
  const memoryStores = createMemoryScopeStores(defaultScopeRoot, () =>
    getMemoryProvider(),
  );
  const knowledgeStores = createKnowledgeScopeStores(defaultScopeRoot, () =>
    getKnowledgeProvider(),
  );
  const historyStores = createHistoryScopeStores(defaultScopeRoot, () =>
    getHistoryProvider(),
  );
  const taskStores = createRepoTasksScopeStores(defaultScopeRoot, () =>
    getRepoTasksProvider(),
  );

  return (scopeId) => {
    const memory = memoryStores.resolve(scopeId);
    if (!memory.ok) {
      return { error: "unknown_scope", scopeId: memory.error.scopeId };
    }
    const knowledge = knowledgeStores.resolve(memory.scopeId);
    if (!knowledge.ok) {
      return { error: "unknown_scope", scopeId: knowledge.error.scopeId };
    }
    const history = historyStores.resolve(memory.scopeId);
    if (!history.ok) {
      return { error: "unknown_scope", scopeId: history.error.scopeId };
    }
    const tasks = taskStores.resolve(memory.scopeId);
    if (!tasks.ok) {
      return { error: "unknown_scope", scopeId: tasks.error.scopeId };
    }
    return {
      scopeId: memory.scopeId,
      scopeRoot: memory.scopeRoot,
      knowledge: knowledge.store,
      memory: memory.store,
      history: history.store,
      tasks: tasks.store,
    };
  };
}
