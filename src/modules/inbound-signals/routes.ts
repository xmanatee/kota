import type {
  ControlRouteRegistration,
  RouteRegistration,
} from "#core/modules/module-types.js";
import { readSelectedScopeSelectorIdQueryOrErrorResponse } from "#core/server/scope-selector-request.js";
import { jsonResponse } from "#core/server/session-pool.js";
import type { InboundSignalRoutingStatus } from "./routing.js";

export function inboundSignalRouteStatusRoutes(
  status: (scopeId?: string) => InboundSignalRoutingStatus,
): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/inbound-signals/routes",
      handler: (req, res) => {
        const scopeId = readSelectedScopeSelectorIdQueryOrErrorResponse(req, res);
        if (scopeId === null) return;
        jsonResponse(res, 200, status(scopeId));
      },
    },
  ];
}

export function inboundSignalRouteStatusControlRoutes(
  status: (scopeId?: string) => InboundSignalRoutingStatus,
): ControlRouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/inbound-signals/routes",
      capabilityScope: "read",
      handler: (req, res) => {
        const scopeId = readSelectedScopeSelectorIdQueryOrErrorResponse(req, res);
        if (scopeId === null) return;
        jsonResponse(res, 200, status(scopeId));
      },
    },
  ];
}
