import type { RouteRegistration } from "#core/modules/module-types.js";
import { jsonResponse } from "#core/server/session-pool.js";
import { resolveRouteScope } from "./route-scope.js";
import {
  handleTaskCapture,
  handleTaskCreate,
  handleTaskCreateNormalized,
  handleTaskMove,
  handleTaskShow,
} from "./routes-lifecycle-handlers.js";
import {
  handleTaskBodyUpdate,
  handleTaskStateChange,
  handleTaskStatus,
} from "./routes-state-handlers.js";
import type { RepoTasksScopeStores } from "./scope.js";

export { taskControlRoutes } from "./routes-control.js";
export {
  handleTaskCapture,
  handleTaskCreate,
  handleTaskCreateNormalized,
  handleTaskMove,
  handleTaskShow,
} from "./routes-lifecycle-handlers.js";
export {
  handleTaskBodyUpdate,
  handleTaskStateChange,
  handleTaskStatus,
} from "./routes-state-handlers.js";

// Sibling literal paths that share the `/api/tasks/<id>` shape with the
// `/api/tasks/:id` show route. Exact routes win, but unsupported methods on
// these names should still 404 instead of being interpreted as task ids.
const RESERVED_TASK_NAMES = new Set(["normalized", "capture"]);

export function taskRoutes(
  scopeStores?: RepoTasksScopeStores,
): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/tasks",
      handler: (req, res) => {
        const scope = resolveRouteScope(scopeStores, req, res);
        if (!scope.ok) return;
        return handleTaskStatus(res, scope.scopeRoot);
      },
    },
    {
      method: "POST",
      path: "/api/tasks",
      handler: (req, res) => {
        const scope = resolveRouteScope(scopeStores, req, res);
        if (!scope.ok) return;
        return handleTaskCreate(req, res, scope);
      },
    },
    {
      method: "POST",
      path: "/api/tasks/normalized",
      handler: (req, res) => {
        const scope = resolveRouteScope(scopeStores, req, res);
        if (!scope.ok) return;
        return handleTaskCreateNormalized(req, res, scope);
      },
    },
    {
      method: "POST",
      path: "/api/tasks/capture",
      handler: (req, res) => {
        const scope = resolveRouteScope(scopeStores, req, res);
        if (!scope.ok) return;
        return handleTaskCapture(req, res, scope);
      },
    },
    {
      method: "PATCH",
      path: "/api/tasks/:id/state",
      handler: (req, res, params) => {
        const scope = resolveRouteScope(scopeStores, req, res);
        if (!scope.ok) return;
        return handleTaskStateChange(req, res, params.id, scope);
      },
    },
    {
      method: "PATCH",
      path: "/api/tasks/:id/move",
      handler: (req, res, params) => {
        const scope = resolveRouteScope(scopeStores, req, res);
        if (!scope.ok) return;
        return handleTaskMove(req, res, params.id, scope);
      },
    },
    {
      method: "PATCH",
      path: "/api/tasks/:id/body",
      handler: (req, res, params) => {
        const scope = resolveRouteScope(scopeStores, req, res);
        if (!scope.ok) return;
        return handleTaskBodyUpdate(req, res, params.id, scope);
      },
    },
    {
      method: "GET",
      path: "/api/tasks/:id",
      handler: (req, res, params) => {
        if (RESERVED_TASK_NAMES.has(params.id)) {
          jsonResponse(res, 404, { error: "Not found" });
          return;
        }
        const scope = resolveRouteScope(scopeStores, req, res);
        if (!scope.ok) return;
        return handleTaskShow(res, params.id, scope.scopeRoot);
      },
    },
  ];
}
