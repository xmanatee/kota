import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import type { ProviderLookupContext } from "#core/modules/module-context-types.js";
import {
  getHistoryProvider,
  getKnowledgeProvider,
  getMemoryProvider,
  getRepoTasksProvider,
  HISTORY_PROVIDER_TOKEN,
  KNOWLEDGE_PROVIDER_TOKEN,
  MEMORY_PROVIDER_TOKEN,
  REPO_TASKS_PROVIDER_TOKEN,
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
  providers?: ProviderLookupContext,
): ResolveRecallScopeContext {
  const daemonScope = providers
    ? () => providers.getProvider(DAEMON_SCOPE_PROVIDER_TYPE)
    : undefined;
  const memoryStores = createMemoryScopeStores(
    defaultScopeRoot,
    () => providers?.getProvider(MEMORY_PROVIDER_TOKEN) ?? getMemoryProvider(),
    daemonScope,
  );
  const knowledgeStores = createKnowledgeScopeStores(
    defaultScopeRoot,
    () => providers?.getProvider(KNOWLEDGE_PROVIDER_TOKEN) ?? getKnowledgeProvider(),
    daemonScope,
  );
  const historyStores = createHistoryScopeStores(
    defaultScopeRoot,
    () => providers?.getProvider(HISTORY_PROVIDER_TOKEN) ?? getHistoryProvider(),
    daemonScope,
  );
  const taskStores = createRepoTasksScopeStores(
    defaultScopeRoot,
    () => providers?.getProvider(REPO_TASKS_PROVIDER_TOKEN) ?? getRepoTasksProvider(),
    daemonScope,
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
