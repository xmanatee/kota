import { join } from "node:path";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import {
  buildDirectoryScope,
  type DirectoryScope,
  type ScopeId,
} from "#core/daemon/scope-registry.js";
import { createDirectoryScopeSelector } from "#core/daemon/scope-selection.js";
import type { ProviderLookupContext } from "#core/modules/module-context-types.js";
import {
  type AnswerHistoryStore,
  answerHistoryRootForScope,
  DiskAnswerHistoryStore,
} from "./answer-history-store.js";
import type { ResolveAnswerScopeContext } from "./answer-types.js";

export function createAnswerScopeContextResolver(
  defaultScopeRoot: string,
  getDefaultHistory?: () => AnswerHistoryStore | null,
  providers?: ProviderLookupContext,
): ResolveAnswerScopeContext {
  const fallbackScope = buildDirectoryScope({ scopeRoot: defaultScopeRoot });
  const stores = new Map<ScopeId, AnswerHistoryStore>();

  const selectScope = createDirectoryScopeSelector({
    defaultScopeRoot,
    ...(providers === undefined ? {} : {
      getDaemonScopeProvider: () => providers.getProvider(DAEMON_SCOPE_PROVIDER_TYPE),
    }),
  });

  function storeFor(scope: DirectoryScope): AnswerHistoryStore {
    if (scope.scopeId === fallbackScope.scopeId) {
      const defaultHistory = getDefaultHistory?.();
      if (defaultHistory) return defaultHistory;
    }
    const existing = stores.get(scope.scopeId);
    if (existing) return existing;
    const store = new DiskAnswerHistoryStore({
      rootDir: answerHistoryRootForScope(join(scope.scopeRoot, ".kota")),
    });
    stores.set(scope.scopeId, store);
    return store;
  }

  return (scopeId) => {
    const selected = selectScope(scopeId);
    if (!selected.ok) {
      return { error: "unknown_scope", scopeId: selected.error.scopeId };
    }
    const scope = selected.scope;
    return {
      scopeId: scope.scopeId,
      scopeRoot: scope.scopeRoot,
      history: storeFor(scope),
    };
  };
}
