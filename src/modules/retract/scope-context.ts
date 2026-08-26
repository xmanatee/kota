import {
  getKnowledgeProvider,
  getMemoryProvider,
} from "#core/modules/provider-registry.js";
import { createKnowledgeScopeStores } from "#modules/knowledge/scope.js";
import { createMemoryScopeStores } from "#modules/memory/scope.js";
import type { RetractScopeContext } from "./retract-types.js";

export type ResolveRetractScopeContext = (
  scopeId: string | null | undefined,
) => RetractScopeContext | { error: "unknown_scope"; scopeId: string };

export function createRetractScopeContextResolver(
  defaultScopeRoot: string,
): ResolveRetractScopeContext {
  const memoryStores = createMemoryScopeStores(defaultScopeRoot, () =>
    getMemoryProvider(),
  );
  const knowledgeStores = createKnowledgeScopeStores(defaultScopeRoot, () =>
    getKnowledgeProvider(),
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
