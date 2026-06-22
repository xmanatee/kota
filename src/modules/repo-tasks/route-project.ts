import type { IncomingMessage, ServerResponse } from "node:http";
import type { getRepoTasksProvider } from "#core/modules/provider-registry.js";
import { readSelectedScopeSelectorIdQueryOrErrorResponse } from "#core/server/scope-selector-request.js";
import { jsonResponse } from "#core/server/session-pool.js";
import type { RepoTasksProjectStores } from "./project-scope.js";

export function resolveRouteProject(
  projectStores: RepoTasksProjectStores | undefined,
  req: IncomingMessage,
  res: ServerResponse,
):
  | { ok: true; projectDir: string; store: ReturnType<typeof getRepoTasksProvider> | null }
  | { ok: false } {
  if (!projectStores) {
    return { ok: true, projectDir: process.cwd(), store: null };
  }
  const selectedId = readSelectedScopeSelectorIdQueryOrErrorResponse(
    req,
    res,
    "http://127.0.0.1",
  );
  if (selectedId === null) return { ok: false };
  const resolved = projectStores.resolve(selectedId);
  if (!resolved.ok) {
    jsonResponse(res, 404, resolved.error);
    return { ok: false };
  }
  return {
    ok: true,
    projectDir: resolved.projectDir,
    store: resolved.store,
  };
}
