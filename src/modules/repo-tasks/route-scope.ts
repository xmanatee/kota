import type { IncomingMessage, ServerResponse } from "node:http";
import { buildDirectoryScope } from "#core/daemon/scope-registry.js";
import type { getRepoTasksProvider } from "#core/modules/provider-registry.js";
import { readSelectedScopeSelectorIdQueryOrErrorResponse } from "#core/server/scope-selector-request.js";
import { jsonResponse } from "#core/server/session-pool.js";
import type { RepoTaskCanonicalMutationTarget } from "./repo-task-mutation-boundary.js";
import type { RepoTasksScopeStores } from "./scope.js";

export type ResolvedRepoTaskRouteScope = RepoTaskCanonicalMutationTarget & {
  store: ReturnType<typeof getRepoTasksProvider> | null;
};

export function resolveRouteScope(
  scopeStores: RepoTasksScopeStores | undefined,
  req: IncomingMessage,
  res: ServerResponse,
):
  | ({ ok: true } & ResolvedRepoTaskRouteScope)
  | { ok: false } {
  if (!scopeStores) {
    const fallback = buildDirectoryScope({ scopeRoot: process.cwd() });
    return {
      ok: true,
		authority: "canonical",
      scopeId: fallback.scopeId,
      scopeRoot: fallback.scopeRoot,
      store: null,
    };
  }
  const selectedId = readSelectedScopeSelectorIdQueryOrErrorResponse(
    req,
    res,
    "http://127.0.0.1",
  );
  if (selectedId === null) return { ok: false };
  const resolved = scopeStores.resolve(selectedId);
  if (!resolved.ok) {
    jsonResponse(res, 404, resolved.error);
    return { ok: false };
  }
  return {
    ok: true,
	authority: "canonical",
    scopeId: resolved.scopeId,
    scopeRoot: resolved.scopeRoot,
    store: resolved.store,
  };
}
