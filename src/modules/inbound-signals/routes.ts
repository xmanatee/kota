import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ControlRouteRegistration,
  RouteRegistration,
} from "#core/modules/module-types.js";
import {
  ScopeSelectorConflictError,
  scopeSelectorConflictBody,
  scopeSelectorFromUrl,
  selectedScopeSelectorId,
} from "#core/server/scope-selector.js";
import { jsonResponse } from "#core/server/session-pool.js";
import type { InboundSignalRoutingStatus } from "./routing.js";

function requestProjectId(
  req: IncomingMessage,
  res: ServerResponse,
): string | null | undefined {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  try {
    return selectedScopeSelectorId(scopeSelectorFromUrl(url));
  } catch (err) {
    if (!(err instanceof ScopeSelectorConflictError)) throw err;
    jsonResponse(res, 400, scopeSelectorConflictBody(err));
    return null;
  }
}

export function inboundSignalRouteStatusRoutes(
  status: (projectId?: string) => InboundSignalRoutingStatus,
): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/inbound-signals/routes",
      handler: (req, res) => {
        const projectId = requestProjectId(req, res);
        if (projectId === null) return;
        jsonResponse(res, 200, status(projectId));
      },
    },
  ];
}

export function inboundSignalRouteStatusControlRoutes(
  status: (projectId?: string) => InboundSignalRoutingStatus,
): ControlRouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/inbound-signals/routes",
      capabilityScope: "read",
      handler: (req, res) => {
        const projectId = requestProjectId(req, res);
        if (projectId === null) return;
        jsonResponse(res, 200, status(projectId));
      },
    },
  ];
}
