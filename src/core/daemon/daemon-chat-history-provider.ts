import type { HistoryScopeProvider } from "#core/modules/provider-registry.js";
import type { HistoryProvider } from "#core/modules/provider-types.js";
import type { ScopeRuntimeRegistry } from "./scope-runtime.js";

export function createChatHistoryProviderResolver(options: {
  scopeRuntimes: ScopeRuntimeRegistry;
  historyScopeProvider: HistoryScopeProvider | null | undefined;
  defaultHistoryProvider?: HistoryProvider | null;
}): (scopeId: string) => HistoryProvider {
  return (scopeId) => {
    const runtime = options.scopeRuntimes.get(scopeId);
    const isDefault =
      runtime.scope.scopeId === options.scopeRuntimes.getDefaultScopeId();
    if (options.historyScopeProvider) {
      return options.historyScopeProvider.forScope({
        scopeId: runtime.scope.scopeId,
        scopeRoot: runtime.scope.scopeRoot,
        isDefault,
      });
    }
    if (isDefault && options.defaultHistoryProvider) {
      return options.defaultHistoryProvider;
    }
    throw new Error(
      `Scope-aware history provider is not registered for scope ${runtime.scope.scopeId}`,
    );
  };
}
