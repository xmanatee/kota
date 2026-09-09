import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import { type DirectoryScope, deriveDirectoryScopeId, type ScopeId } from "#core/daemon/scope-registry.js";
import { createDirectoryScopeSelector, type DirectoryScopeSelectionOptions } from "#core/daemon/scope-selection.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { HISTORY_PROVIDER_TOKEN } from "#core/modules/provider-registry.js";
import type { HistoryProvider } from "#core/modules/provider-types.js";
import { getScopeHistoryStore } from "./history.js";

export type HistoryScopeStoresOptions = DirectoryScopeSelectionOptions & {
  getDefaultProvider?: () => HistoryProvider | null;
};

export class HistoryScopeStores {
  private readonly providerScopeId: ScopeId;
  private readonly selectScope: ReturnType<typeof createDirectoryScopeSelector>;
  private readonly getDefaultProvider: (() => HistoryProvider | null) | undefined;
  private readonly stores = new Map<ScopeId, HistoryProvider>();

  constructor(options: HistoryScopeStoresOptions) {
    this.providerScopeId = deriveDirectoryScopeId(options.defaultScopeRoot);
    this.selectScope = createDirectoryScopeSelector(options);
    this.getDefaultProvider = options.getDefaultProvider;
  }

  resolve(scopeId: string | null | undefined) {
    const selected = this.selectScope(scopeId);
    if (!selected.ok) return selected;
    return {
      ok: true as const,
      scopeId: selected.scope.scopeId,
      scopeRoot: selected.scope.scopeRoot,
      store: this.storeFor(selected.scope),
    };
  }

  private storeFor(scope: DirectoryScope): HistoryProvider {
    if (scope.scopeId === this.providerScopeId) {
      const provider = this.getDefaultProvider?.();
      if (provider) return provider;
    }
    const existing = this.stores.get(scope.scopeId);
    if (existing) return existing;
    const store = getScopeHistoryStore(scope.scopeRoot);
    this.stores.set(scope.scopeId, store);
    return store;
  }
}

export function createHistoryScopeStores(
  ctx: Pick<ModuleContext, "cwd" | "getProvider">,
): HistoryScopeStores {
  return new HistoryScopeStores({
    defaultScopeRoot: ctx.cwd,
    getDefaultProvider: () => ctx.getProvider(HISTORY_PROVIDER_TOKEN),
    getDaemonScopeProvider: () => ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE),
  });
}
