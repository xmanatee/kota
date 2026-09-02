import type { IncomingMessage, ServerResponse } from "node:http";
import type { ControlRouteRegistration } from "#core/modules/module-types.js";
import { getRepoTasksProvider } from "#core/modules/provider-registry.js";
import { jsonResponse } from "#core/server/session-pool.js";
import type { RepoTaskState as ContractRepoTaskState } from "./client.js";
import { REPO_TASK_STATES } from "./repo-tasks-domain.js";
import {
  listRepoTasks,
  reindexRepoTasks,
  searchRepoTasks,
} from "./repo-tasks-operations.js";
import { RepoTasksDefaultStore } from "./repo-tasks-store.js";
import { resolveRouteScope } from "./route-scope.js";
import type { RepoTasksScopeStores } from "./scope.js";

type RequestedTaskStates =
  | { ok: true; states: ContractRepoTaskState[] | undefined }
  | { ok: false; state: string };

function requestedTaskStates(url: URL): RequestedTaskStates {
  const requested = url.searchParams.getAll("state");
  const invalid = requested.find(
    (state) => !(REPO_TASK_STATES as readonly string[]).includes(state),
  );
  if (invalid !== undefined) return { ok: false, state: invalid };
  return {
    ok: true,
    states: requested.length > 0
      ? requested as ContractRepoTaskState[]
      : undefined,
  };
}

function rejectInvalidTaskState(
  res: ServerResponse,
  requested: RequestedTaskStates,
): requested is Extract<RequestedTaskStates, { ok: false }> {
  if (requested.ok) return false;
  jsonResponse(res, 400, {
    error: `Invalid task state: ${requested.state}`,
    reason: "invalid_state",
    state: requested.state,
  });
  return true;
}

function handleTasksListControl(
  req: IncomingMessage,
  res: ServerResponse,
  scopeStores?: RepoTasksScopeStores,
): void {
  const scope = resolveRouteScope(scopeStores, req, res);
  if (!scope.ok) return;
  const url = new URL(req.url ?? "/tasks", "http://127.0.0.1");
  const requested = requestedTaskStates(url);
  if (rejectInvalidTaskState(res, requested)) return;
  jsonResponse(res, 200, listRepoTasks(scope.scopeRoot, requested.states));
}

async function handleTasksSearchControl(
  req: IncomingMessage,
  res: ServerResponse,
  scopeStores?: RepoTasksScopeStores,
): Promise<void> {
  const url = new URL(req.url ?? "/tasks/search", "http://127.0.0.1");
  const query = url.searchParams.get("q") ?? "";
  const semantic = url.searchParams.get("semantic") !== "false";
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam
    ? Math.max(1, Number.parseInt(limitParam, 10) || 0)
    : 20;
  const requested = requestedTaskStates(url);
  if (rejectInvalidTaskState(res, requested)) return;
  try {
    const scope = resolveRouteScope(scopeStores, req, res);
    if (!scope.ok) return;
    const provider = scope.store ?? getRepoTasksProvider();
    jsonResponse(res, 200, await searchRepoTasks(
      provider,
      new RepoTasksDefaultStore(scope.scopeRoot),
      query,
      {
        semantic,
        limit,
        ...(requested.states && { states: requested.states }),
      },
    ));
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
  scopeStores?: RepoTasksScopeStores,
): Promise<void> {
  try {
    const scope = resolveRouteScope(scopeStores, req, res);
    if (!scope.ok) return;
    const provider = scope.store ?? getRepoTasksProvider();
    jsonResponse(res, 200, await reindexRepoTasks(provider));
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export function taskControlRoutes(
  scopeStores?: RepoTasksScopeStores,
): ControlRouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/tasks",
      capabilityScope: "read",
      handler: (req, res) => handleTasksListControl(req, res, scopeStores),
    },
    {
      method: "GET",
      path: "/tasks/search",
      capabilityScope: "read",
      handler: (req, res) => handleTasksSearchControl(req, res, scopeStores),
    },
    {
      method: "POST",
      path: "/tasks/reindex",
      capabilityScope: "control",
      handler: (req, res) => handleTasksReindexControl(req, res, scopeStores),
    },
  ];
}
