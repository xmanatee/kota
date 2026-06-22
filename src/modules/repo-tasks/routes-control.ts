import type { IncomingMessage, ServerResponse } from "node:http";
import type { ControlRouteRegistration } from "#core/modules/module-types.js";
import { getRepoTasksProvider } from "#core/modules/provider-registry.js";
import { jsonResponse } from "#core/server/session-pool.js";
import type { RepoTaskState as ContractRepoTaskState } from "./client.js";
import type { RepoTasksProjectStores } from "./project-scope.js";
import { REPO_TASK_STATES } from "./repo-tasks-domain.js";
import { resolveRouteProject } from "./route-project.js";

async function handleTasksSearchControl(
  req: IncomingMessage,
  res: ServerResponse,
  projectStores?: RepoTasksProjectStores,
): Promise<void> {
  const url = new URL(req.url ?? "/tasks/search", "http://127.0.0.1");
  const query = url.searchParams.get("q") ?? "";
  const semantic = url.searchParams.get("semantic") !== "false";
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam
    ? Math.max(1, Number.parseInt(limitParam, 10) || 0)
    : 20;
  const stateParams = url.searchParams.getAll("state");
  const states = stateParams.filter((s): s is ContractRepoTaskState =>
    (REPO_TASK_STATES as readonly string[]).includes(s),
  );
  try {
    const project = resolveRouteProject(projectStores, req, res);
    if (!project.ok) return;
    const provider = project.store ?? getRepoTasksProvider();
    if (semantic && !provider.supportsSemanticSearch()) {
      jsonResponse(res, 200, { ok: false, reason: "semantic_unavailable" });
      return;
    }
    const opts: { topK: number; states?: ContractRepoTaskState[] } = { topK: limit };
    if (states.length > 0) opts.states = states;
    const tasks = await provider.searchTasks(query, opts);
    jsonResponse(res, 200, { ok: true, tasks });
  } catch (err) {
    if (semantic) {
      jsonResponse(res, 200, { ok: false, reason: "semantic_unavailable" });
      return;
    }
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

async function handleTasksReindexControl(
  req: IncomingMessage,
  res: ServerResponse,
  projectStores?: RepoTasksProjectStores,
): Promise<void> {
  try {
    const project = resolveRouteProject(projectStores, req, res);
    if (!project.ok) return;
    const provider = project.store ?? getRepoTasksProvider();
    const result = await provider.reindex();
    jsonResponse(res, 200, result);
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export function taskControlRoutes(
  projectStores?: RepoTasksProjectStores,
): ControlRouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/tasks/search",
      capabilityScope: "read",
      handler: (req, res) => handleTasksSearchControl(req, res, projectStores),
    },
    {
      method: "POST",
      path: "/tasks/reindex",
      capabilityScope: "control",
      handler: (req, res) => handleTasksReindexControl(req, res, projectStores),
    },
  ];
}
