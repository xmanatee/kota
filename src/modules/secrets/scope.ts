import {
  getScopeSecretStore,
  type SecretStore,
} from "#core/config/secrets.js";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import {
  buildDirectoryScope,
  type DirectoryScope,
  type ScopeId,
} from "#core/daemon/scope-registry.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import {
  normalizeScopeSelectorArgument,
  type ScopeSelectorArgument,
  type UnknownScopeSelectorBody,
  unknownScopeSelectorBody,
} from "#core/server/scope-selector.js";

export type SecretScopeStoresOptions = {
  defaultScopeRoot: string;
  scopes?: readonly DirectoryScope[];
  defaultScopeId?: ScopeId;
  getActiveScopeId?: () => ScopeId | null;
};

export type ResolvedSecretScopeStore = {
  scopeId: ScopeId;
  scopeRoot: string;
  store: SecretStore;
};

export class SecretScopeStores {
  private readonly scopes: readonly DirectoryScope[];
  private readonly defaultScopeId: ScopeId;
  private readonly getActiveScopeId: () => ScopeId | null;

  constructor(options: SecretScopeStoresOptions) {
    const defaultScope = buildDirectoryScope({
      scopeRoot: options.defaultScopeRoot,
    });
    this.scopes = options.scopes ?? [defaultScope];
    const firstScope = this.scopes[0];
    if (!firstScope) {
      throw new Error("SecretScopeStores requires at least one scope");
    }
    this.defaultScopeId = options.defaultScopeId ?? firstScope.scopeId;
    if (!this.scopes.some((scope) => scope.scopeId === this.defaultScopeId)) {
      throw new Error(
        `SecretScopeStores default scope ${this.defaultScopeId} is not registered`,
      );
    }
    this.getActiveScopeId = options.getActiveScopeId ?? (() => null);
  }

  resolve(
    selector?: ScopeSelectorArgument,
  ):
    | { ok: true; value: ResolvedSecretScopeStore }
    | { ok: false; error: UnknownScopeSelectorBody } {
    const normalized = normalizeScopeSelectorArgument(selector);
    const selectedId = normalized.scopeId;
    const daemonScope = getProviderRegistry()?.get(
      DAEMON_SCOPE_PROVIDER_TYPE,
    );
    if (daemonScope) {
      const resolved = daemonScope.resolveScopeRuntime(selectedId);
      if (!resolved.ok) {
        const unresolvedId = selectedId ?? resolved.error.scopeId;
        return {
          ok: false,
          error: unknownScopeSelectorBody(unresolvedId),
        };
      }
      return {
        ok: true,
        value: {
          scopeId: resolved.runtime.scope.scopeId,
          scopeRoot: resolved.runtime.scope.scopeRoot,
          store: resolved.runtime.secretStore,
        },
      };
    }

    const scopeId = selectedId
      ?? this.getActiveScopeId()
      ?? this.defaultScopeId;
    const scope = this.scopes.find((entry) => entry.scopeId === scopeId);
    if (!scope) {
      return {
        ok: false,
        error: unknownScopeSelectorBody(scopeId),
      };
    }
    return {
      ok: true,
      value: {
        scopeId: scope.scopeId,
        scopeRoot: scope.scopeRoot,
        store: getScopeSecretStore(scope.scopeRoot),
      },
    };
  }
}

export function createSecretScopeStores(
  defaultScopeRoot: string,
): SecretScopeStores {
  return new SecretScopeStores({ defaultScopeRoot });
}

export function requireSecretStore(
  scopeStores: SecretScopeStores,
  selector?: ScopeSelectorArgument,
): SecretStore {
  const resolved = scopeStores.resolve(selector);
  if (resolved.ok) return resolved.value.store;
  if (resolved.error.reason === "unknown_scope") {
    throw new Error(`Unknown scope: ${resolved.error.scopeId}`);
  }
  throw new Error(`Unknown scope: ${resolved.error.scopeId}`);
}
