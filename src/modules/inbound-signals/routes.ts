import type { IncomingMessage } from "node:http";
import type {
  ControlRouteRegistration,
  RouteRegistration,
} from "#core/modules/module-types.js";
import { jsonResponse } from "#core/server/session-pool.js";
import type { InboundSignalRoutingStatus } from "./routing.js";

function requestProjectId(req: IncomingMessage): string | undefined {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const projectId = url.searchParams.get("projectId")?.trim();
  return projectId ? projectId : undefined;
}

export function inboundSignalRouteStatusRoutes(
  status: (projectId?: string) => InboundSignalRoutingStatus,
): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/inbound-signals/routes",
      handler: (req, res) => {
        jsonResponse(res, 200, status(requestProjectId(req)));
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
        jsonResponse(res, 200, status(requestProjectId(req)));
      },
    },
  ];
}
