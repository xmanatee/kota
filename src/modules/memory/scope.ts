import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import { type DirectoryScope, deriveDirectoryScopeId, type ScopeId } from "#core/daemon/scope-registry.js";
import { createDirectoryScopeSelector, type DirectoryScopeSelectionOptions } from "#core/daemon/scope-selection.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { MEMORY_PROVIDER_TOKEN } from "#core/modules/provider-registry.js";
import type { MemoryProvider } from "#core/modules/provider-types.js";
import { getScopeMemoryStore } from "./store.js";

export type MemoryScopeStoresOptions = DirectoryScopeSelectionOptions & {
  getDefaultProvider?: () => MemoryProvider | null;
};

export class MemoryScopeStores {
  private readonly providerScopeId: ScopeId;
  private readonly selectScope: ReturnType<typeof createDirectoryScopeSelector>;
  private readonly getDefaultProvider: (() => MemoryProvider | null) | undefined;
  private readonly stores = new Map<ScopeId, MemoryProvider>();

  constructor(options: MemoryScopeStoresOptions) {
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

  private storeFor(scope: DirectoryScope): MemoryProvider {
    if (scope.scopeId === this.providerScopeId) {
      const provider = this.getDefaultProvider?.();
      if (provider) return provider;
    }
    const existing = this.stores.get(scope.scopeId);
    if (existing) return existing;
    const store = getScopeMemoryStore(scope.scopeRoot);
    this.stores.set(scope.scopeId, store);
    return store;
  }
}

export function createMemoryScopeStores(
  ctx: Pick<ModuleContext, "cwd" | "getProvider">,
): MemoryScopeStores {
  return new MemoryScopeStores({
    defaultScopeRoot: ctx.cwd,
    getDefaultProvider: () => {
      const provider = ctx.getProvider(MEMORY_PROVIDER_TOKEN);
      if (!provider) throw new Error("memory provider is not registered");
      return provider;
    },
    getDaemonScopeProvider: () => ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE),
  });
}
