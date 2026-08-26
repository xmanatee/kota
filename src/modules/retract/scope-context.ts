import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import type { ProviderLookupContext } from "#core/modules/module-context-types.js";
import {
  getKnowledgeProvider,
  getMemoryProvider,
  KNOWLEDGE_PROVIDER_TOKEN,
  MEMORY_PROVIDER_TOKEN,
} from "#core/modules/provider-registry.js";
import { createKnowledgeScopeStores } from "#modules/knowledge/scope.js";
import { createMemoryScopeStores } from "#modules/memory/scope.js";
import type { RetractScopeContext } from "./retract-types.js";

export type ResolveRetractScopeContext = (
  scopeId: string | null | undefined,
) => RetractScopeContext | { error: "unknown_scope"; scopeId: string };

export function createRetractScopeContextResolver(
  defaultScopeRoot: string,
  providers?: ProviderLookupContext,
): ResolveRetractScopeContext {
  const memoryStores = createMemoryScopeStores(
    defaultScopeRoot,
    () => providers?.getProvider(MEMORY_PROVIDER_TOKEN) ?? getMemoryProvider(),
    providers ? () => providers.getProvider(DAEMON_SCOPE_PROVIDER_TYPE) : undefined,
  );
  const knowledgeStores = createKnowledgeScopeStores(
    defaultScopeRoot,
    () => providers?.getProvider(KNOWLEDGE_PROVIDER_TOKEN) ?? getKnowledgeProvider(),
    providers ? () => providers.getProvider(DAEMON_SCOPE_PROVIDER_TYPE) : undefined,
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
    return {
      scopeId: memory.scopeId,
      scopeRoot: memory.scopeRoot,
      memory: memory.store,
      knowledge: knowledge.store,
    };
  };
}
