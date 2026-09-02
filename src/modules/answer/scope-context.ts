import { join } from "node:path";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import {
  buildDirectoryScope,
  type DirectoryScope,
  directoryScopesFromProjection,
  type ScopeId,
} from "#core/daemon/scope-registry.js";
import type { ProviderLookupContext } from "#core/modules/module-context-types.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import {
  type AnswerHistoryStore,
  answerHistoryRootForScope,
  DiskAnswerHistoryStore,
} from "./answer-history-store.js";
import type { ResolveAnswerScopeContext } from "./answer-types.js";

type ScopeSnapshot = {
  defaultScopeId: ScopeId;
  activeScopeId: ScopeId | null;
  scopes: readonly DirectoryScope[];
};

export function createAnswerScopeContextResolver(
  defaultScopeRoot: string,
  getDefaultHistory?: () => AnswerHistoryStore | null,
  providers?: ProviderLookupContext,
): ResolveAnswerScopeContext {
  const fallbackScope = buildDirectoryScope({ scopeRoot: defaultScopeRoot });
  const stores = new Map<ScopeId, AnswerHistoryStore>();

  function snapshot(): ScopeSnapshot {
    const daemonScope = providers?.getProvider(DAEMON_SCOPE_PROVIDER_TYPE)
      ?? getProviderRegistry()?.get(DAEMON_SCOPE_PROVIDER_TYPE);
    if (daemonScope) {
      const projection = daemonScope.getScopeRegistryProjection();
      return {
        defaultScopeId: projection.defaultScopeId,
        activeScopeId: daemonScope.getActiveScopeId(),
        scopes: directoryScopesFromProjection(projection),
      };
    }
    return {
      defaultScopeId: fallbackScope.scopeId,
      activeScopeId: null,
      scopes: [fallbackScope],
    };
  }

  function storeFor(
    scope: DirectoryScope,
    defaultScopeId: ScopeId,
  ): AnswerHistoryStore {
    if (scope.scopeId === defaultScopeId) {
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
    const current = snapshot();
    const requested = scopeId?.trim();
    const resolvedScopeId =
      requested && requested.length > 0
        ? requested
        : current.activeScopeId ?? current.defaultScopeId;
    const scope = current.scopes.find(
      (entry) => entry.scopeId === resolvedScopeId,
    );
    if (!scope) {
      return { error: "unknown_scope", scopeId: resolvedScopeId };
    }
    return {
      scopeId: scope.scopeId,
      scopeRoot: scope.scopeRoot,
      history: storeFor(scope, current.defaultScopeId),
    };
  };
}
