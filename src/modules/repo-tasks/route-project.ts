import type { IncomingMessage, ServerResponse } from "node:http";
import { buildConfiguredProject } from "#core/daemon/scope-registry.js";
import type { getRepoTasksProvider } from "#core/modules/provider-registry.js";
import { readSelectedScopeSelectorIdQueryOrErrorResponse } from "#core/server/scope-selector-request.js";
import { jsonResponse } from "#core/server/session-pool.js";
import type { RepoTasksProjectStores } from "./project-scope.js";
import type { RepoTaskMutationTarget } from "./repo-task-mutation-boundary.js";

export type ResolvedRepoTaskRouteProject = RepoTaskMutationTarget & {
  store: ReturnType<typeof getRepoTasksProvider> | null;
};

export function resolveRouteProject(
  projectStores: RepoTasksProjectStores | undefined,
  req: IncomingMessage,
  res: ServerResponse,
):
  | ({ ok: true } & ResolvedRepoTaskRouteProject)
  | { ok: false } {
  if (!projectStores) {
    const fallback = buildConfiguredProject({ projectDir: process.cwd() });
    return {
      ok: true,
		authority: "canonical",
      projectId: fallback.projectId,
      projectDir: fallback.projectDir,
      store: null,
    };
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
	authority: "canonical",
    projectId: resolved.projectId,
    projectDir: resolved.projectDir,
    store: resolved.store,
  };
}
