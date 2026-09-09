import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import type { ProviderLookupContext } from "#core/modules/module-context-types.js";
import {
  getKnowledgeProvider,
  getMemoryProvider,
  KNOWLEDGE_PROVIDER_TOKEN,
  MEMORY_PROVIDER_TOKEN,
} from "#core/modules/provider-registry.js";
import { WORKFLOW_DISPATCHER_PROVIDER_TYPE } from "#core/workflow/workflow-dispatcher-provider.js";
import { KnowledgeScopeStores } from "#modules/knowledge/scope.js";
import { MemoryScopeStores } from "#modules/memory/scope.js";
import type { CaptureScopeContext } from "./capture-types.js";

export type ResolveCaptureScopeContext = (
  scopeId: string | null | undefined,
) => CaptureScopeContext | { error: "unknown_scope"; scopeId: string };

export function createCaptureScopeContextResolver(
  defaultScopeRoot: string,
  providers?: ProviderLookupContext,
): ResolveCaptureScopeContext {
  const memoryStores = new MemoryScopeStores({
    defaultScopeRoot,
    getDefaultProvider: () => providers?.getProvider(MEMORY_PROVIDER_TOKEN) ?? getMemoryProvider(),
    getDaemonScopeProvider: providers ? () => providers.getProvider(DAEMON_SCOPE_PROVIDER_TYPE) : undefined,
  });
  const knowledgeStores = new KnowledgeScopeStores({
    defaultScopeRoot,
    getDefaultProvider: () => providers?.getProvider(KNOWLEDGE_PROVIDER_TOKEN) ?? getKnowledgeProvider(),
    getDaemonScopeProvider: providers ? () => providers.getProvider(DAEMON_SCOPE_PROVIDER_TYPE) : undefined,
  });

  return (scopeId) => {
    const memory = memoryStores.resolve(scopeId);
    if (!memory.ok) {
      return { error: "unknown_scope", scopeId: memory.error.scopeId };
    }
    const knowledge = knowledgeStores.resolve(memory.scopeId);
    if (!knowledge.ok) {
      return { error: "unknown_scope", scopeId: knowledge.error.scopeId };
    }
    return {
      scopeId: memory.scopeId,
      scopeRoot: memory.scopeRoot,
      memory: memory.store,
      knowledge: knowledge.store,
      getWorkflowDispatcher: () =>
        providers?.getProvider(WORKFLOW_DISPATCHER_PROVIDER_TYPE) ?? null,
    };
  };
}
