import { getProviderRegistry } from "#core/modules/provider-registry.js";
import type { UnknownScopeError } from "./daemon-control-types.js";
import { DAEMON_SCOPE_PROVIDER_TYPE, type DaemonScopeProvider } from "./scope-provider.js";
import {
  buildDirectoryScope,
  type DirectoryScope,
  directoryScopesFromProjection,
  type ScopeId,
} from "./scope-registry.js";

export type DirectoryScopeSelectionOptions = {
  defaultScopeRoot: string;
  scopes?: readonly DirectoryScope[];
  defaultScopeId?: ScopeId;
  getActiveScopeId?: () => ScopeId | null;
  getDaemonScopeProvider?: () => Pick<
    DaemonScopeProvider,
    "getScopeRegistryProjection" | "getActiveScopeId"
  > | null;
};

export type DirectoryScopeSelection =
  | { ok: true; scope: DirectoryScope }
  | { ok: false; error: UnknownScopeError };

/** Select at invocation time; a host-bound lookup never falls through to another host. */
export function createDirectoryScopeSelector(options: DirectoryScopeSelectionOptions) {
  const scopes = options.scopes ?? [buildDirectoryScope({ scopeRoot: options.defaultScopeRoot })];
  const firstScope = scopes[0];
  if (!firstScope) throw new Error("Scope selection requires at least one scope");
  const defaultScopeId = options.defaultScopeId ?? firstScope.scopeId;
  if (!scopes.some((scope) => scope.scopeId === defaultScopeId)) {
    throw new Error(`Default scope ${defaultScopeId} is not registered`);
  }
  const getDaemonScopeProvider = options.getDaemonScopeProvider
    ?? (() => getProviderRegistry()?.get(DAEMON_SCOPE_PROVIDER_TYPE) ?? null);

  return (scopeId: string | null | undefined): DirectoryScopeSelection => {
    const daemon = getDaemonScopeProvider();
    const projection = daemon?.getScopeRegistryProjection();
    const currentScopes = projection ? directoryScopesFromProjection(projection) : scopes;
    const currentDefault = projection?.defaultScopeId ?? defaultScopeId;
    const activeScopeId = daemon ? daemon.getActiveScopeId() : options.getActiveScopeId?.();
    const selectedId = scopeId?.trim() || (activeScopeId ?? currentDefault);
    const scope = currentScopes.find((entry) => entry.scopeId === selectedId);
    return scope
      ? { ok: true, scope }
      : { ok: false, error: { error: "Unknown scope", reason: "unknown_scope", scopeId: selectedId } };
  };
}
