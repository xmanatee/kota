import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import { type DirectoryScope, deriveDirectoryScopeId, type ScopeId } from "#core/daemon/scope-registry.js";
import { createDirectoryScopeSelector, type DirectoryScopeSelectionOptions } from "#core/daemon/scope-selection.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { KNOWLEDGE_PROVIDER_TOKEN } from "#core/modules/provider-registry.js";
import type { KnowledgeProvider } from "#core/modules/provider-types.js";
import { KnowledgeStore } from "./store.js";

export type KnowledgeScopeStoresOptions = DirectoryScopeSelectionOptions & {
  getDefaultProvider?: () => KnowledgeProvider | null;
  globalDir?: string;
};

export class KnowledgeScopeStores {
  private readonly providerScopeId: ScopeId;
  private readonly selectScope: ReturnType<typeof createDirectoryScopeSelector>;
  private readonly getDefaultProvider: (() => KnowledgeProvider | null) | undefined;
  private readonly globalDir: string | undefined;
  private readonly stores = new Map<ScopeId, KnowledgeProvider>();

  constructor(options: KnowledgeScopeStoresOptions) {
    this.providerScopeId = deriveDirectoryScopeId(options.defaultScopeRoot);
    this.selectScope = createDirectoryScopeSelector(options);
    this.getDefaultProvider = options.getDefaultProvider;
    this.globalDir = options.globalDir;
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

  private storeFor(scope: DirectoryScope): KnowledgeProvider {
    if (scope.scopeId === this.providerScopeId) {
      const provider = this.getDefaultProvider?.();
      if (provider) return provider;
    }
    const existing = this.stores.get(scope.scopeId);
    if (existing) return existing;
    const store = new KnowledgeStore(scope.scopeRoot, this.globalDir);
    this.stores.set(scope.scopeId, store);
    return store;
  }
}

export function createKnowledgeScopeStores(
  ctx: Pick<ModuleContext, "cwd" | "getProvider">,
): KnowledgeScopeStores {
  return new KnowledgeScopeStores({
    defaultScopeRoot: ctx.cwd,
    getDefaultProvider: () => {
      const provider = ctx.getProvider(KNOWLEDGE_PROVIDER_TOKEN);
      if (!provider) throw new Error("knowledge provider is not registered");
      return provider;
    },
    getDaemonScopeProvider: () => ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE),
  });
}
