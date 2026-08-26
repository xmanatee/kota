import type { RouteRegistration } from "#core/modules/module-types.js";
import { jsonResponse } from "#core/server/session-pool.js";
import type { RepoTasksProjectStores } from "./project-scope.js";
import { resolveRouteProject } from "./route-project.js";
import {
  handleTaskCapture,
  handleTaskCreate,
  handleTaskCreateNormalized,
  handleTaskGc,
  handleTaskMove,
  handleTaskShow,
} from "./routes-lifecycle-handlers.js";
import {
  handleTaskBodyUpdate,
  handleTaskStateChange,
  handleTaskStatus,
} from "./routes-state-handlers.js";

export { taskControlRoutes } from "./routes-control.js";
export {
  handleTaskCapture,
  handleTaskCreate,
  handleTaskCreateNormalized,
  handleTaskGc,
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
const RESERVED_TASK_NAMES = new Set(["normalized", "capture", "gc"]);

export function taskRoutes(
  projectStores?: RepoTasksProjectStores,
): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/tasks",
      handler: (req, res) => {
        const project = resolveRouteProject(projectStores, req, res);
        if (!project.ok) return;
        return handleTaskStatus(res, project.projectDir);
      },
    },
    {
      method: "POST",
      path: "/api/tasks",
      handler: (req, res) => {
        const project = resolveRouteProject(projectStores, req, res);
        if (!project.ok) return;
        return handleTaskCreate(req, res, project);
      },
    },
    {
      method: "POST",
      path: "/api/tasks/normalized",
      handler: (req, res) => {
        const project = resolveRouteProject(projectStores, req, res);
        if (!project.ok) return;
        return handleTaskCreateNormalized(req, res, project);
      },
    },
    {
      method: "POST",
      path: "/api/tasks/capture",
      handler: (req, res) => {
        const project = resolveRouteProject(projectStores, req, res);
        if (!project.ok) return;
        return handleTaskCapture(req, res, project);
      },
    },
    {
      method: "POST",
      path: "/api/tasks/gc",
      handler: (req, res) => {
        const project = resolveRouteProject(projectStores, req, res);
        if (!project.ok) return;
        return handleTaskGc(req, res, project);
      },
    },
    {
      method: "PATCH",
      path: "/api/tasks/:id/state",
      handler: (req, res, params) => {
        const project = resolveRouteProject(projectStores, req, res);
        if (!project.ok) return;
        return handleTaskStateChange(req, res, params.id, project);
      },
    },
    {
      method: "PATCH",
      path: "/api/tasks/:id/move",
      handler: (req, res, params) => {
        const project = resolveRouteProject(projectStores, req, res);
        if (!project.ok) return;
        return handleTaskMove(req, res, params.id, project);
      },
    },
    {
      method: "PATCH",
      path: "/api/tasks/:id/body",
      handler: (req, res, params) => {
        const project = resolveRouteProject(projectStores, req, res);
        if (!project.ok) return;
        return handleTaskBodyUpdate(req, res, params.id, project);
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
        const project = resolveRouteProject(projectStores, req, res);
        if (!project.ok) return;
        return handleTaskShow(res, params.id, project.projectDir);
      },
    },
  ];
}
