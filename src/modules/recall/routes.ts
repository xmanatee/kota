/**
 * HTTP routes for the cross-store recall seam.
 *
 * Two surfaces share one handler:
 * - `POST /recall` on the daemon-control server (capability scope `read`),
 *   consumed by other daemon clients through `KotaClient.recall.recall()`.
 * - `POST /api/recall` on the user-facing HTTP server, consumed by the web
 *   client. The same handler answers both so the wire shape cannot drift
 *   between operator surfaces.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ControlRouteRegistration,
  RouteRegistration,
} from "#core/modules/module-types.js";
import { selectedScopeSelectorIdOrErrorResponse } from "#core/server/scope-selector-request.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import type { RecallResult } from "./client.js";
import { decodeRecallQueryRequest } from "./query.js";
import {
  type RecallProvider,
  RecallScopeSelectionError,
} from "./recall-types.js";

export function createRecallRouteHandler(
  resolveProvider: () => RecallProvider,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async function handler(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    let body: Record<string, unknown>;
    try {
      body = await readBody(req);
    } catch {
      jsonResponse(res, 400, { error: "Invalid request body" });
      return;
    }
    const decoded = decodeRecallQueryRequest(body);
    if (!decoded) {
      jsonResponse(res, 400, { error: "query is required" });
      return;
    }
    const { query, filter } = decoded;
    try {
      const selectedId = selectedScopeSelectorIdOrErrorResponse(res, filter);
      if (selectedId === null) return;
      const scopedFilter = selectedId === undefined
        ? filter
        : { ...filter, scopeId: selectedId };
      const result = await resolveProvider().recall(query, scopedFilter);
      jsonResponse(res, 200, result satisfies RecallResult);
    } catch (err) {
      if (err instanceof RecallScopeSelectionError) {
        jsonResponse(res, 404, {
          error: "Unknown scope",
          reason: err.reason,
          scopeId: err.scopeId,
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      jsonResponse(res, 500, { error: message });
    }
  };
}

export function recallControlRoutes(
  resolveProvider: () => RecallProvider,
): ControlRouteRegistration[] {
  return [
    {
      method: "POST",
      path: "/recall",
      capabilityScope: "read",
      handler: createRecallRouteHandler(resolveProvider),
    },
  ];
}

export function recallApiRoutes(
  resolveProvider: () => RecallProvider,
): RouteRegistration[] {
  return [
    {
      method: "POST",
      path: "/api/recall",
      handler: createRecallRouteHandler(resolveProvider),
    },
  ];
}
