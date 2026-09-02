/**
 * HTTP routes for the cited-answer seam.
 *
 * `POST /answer` on the daemon-control server (capability scope `read`,
 * since the seam reads stores and runs one model call) and
 * `POST /api/answer` on the user-facing HTTP server share one handler
 * — the wire shape cannot drift between operator surfaces.
 *
 * `GET /answers` and `GET /answers/:id` (plus the `/api` twins) read
 * from the persisted answer-history store. Both surfaces share one
 * handler factory so paginated list and single-record views cannot
 * drift between user-facing and control surfaces.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ControlRouteRegistration,
  RouteRegistration,
} from "#core/modules/module-types.js";
import type { ScopeSelector } from "#core/server/scope-selector.js";
import { selectedScopeSelectorIdOrErrorResponse } from "#core/server/scope-selector-request.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import { decodeRecallQueryRequest } from "#modules/recall/query.js";
import { AnswerScopeSelectionError } from "./answer-types.js";
import type { AnswerClient, AnswerResult } from "./client.js";

export function createAnswerRouteHandler(
  resolveProvider: () => AnswerClient,
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
      const result = await resolveProvider().answer(query, scopedFilter);
      jsonResponse(res, 200, result satisfies AnswerResult);
    } catch (err) {
      if (err instanceof AnswerScopeSelectionError) {
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

export function answerControlRoutes(
  resolveProvider: () => AnswerClient,
): ControlRouteRegistration[] {
  const historyHandlers = createAnswerHistoryRouteHandler(resolveProvider);
  return [
    {
      method: "POST",
      path: "/answer",
      capabilityScope: "read",
      handler: createAnswerRouteHandler(resolveProvider),
    },
    {
      method: "GET",
      path: "/answers",
      capabilityScope: "read",
      handler: (req, res) => historyHandlers.list(req, res),
    },
    {
      method: "GET",
      path: "/answers/:id",
      capabilityScope: "read",
      handler: (req, res, params) => historyHandlers.showById(params.id, req, res),
    },
  ];
}

export function answerApiRoutes(
  resolveProvider: () => AnswerClient,
): RouteRegistration[] {
  const historyHandlers = createAnswerHistoryRouteHandler(resolveProvider);
  return [
    {
      method: "POST",
      path: "/api/answer",
      handler: createAnswerRouteHandler(resolveProvider),
    },
    {
      method: "GET",
      path: "/api/answers",
      handler: (req, res) => historyHandlers.list(req, res),
    },
    {
      method: "GET",
      path: "/api/answers/:id",
      handler: async (req, res, params) => {
        await historyHandlers.showById(params.id, req, res);
      },
    },
  ];
}

type ListQuery = {
  limit?: number;
  beforeId?: string;
} & ScopeSelector;

function parseListQuery(req: IncomingMessage): ListQuery {
  const url = req.url ?? "";
  const queryStart = url.indexOf("?");
  if (queryStart < 0) return {};
  const params = new URLSearchParams(url.slice(queryStart + 1));
  const out: ListQuery = {};
  const limit = params.get("limit");
  if (limit !== null) {
    const parsed = Number.parseInt(limit, 10);
    if (Number.isFinite(parsed) && parsed > 0) out.limit = parsed;
  }
  const beforeId = params.get("beforeId");
  if (beforeId !== null && beforeId !== "") out.beforeId = beforeId;
  const scopeId = params.get("scopeId");
  if (scopeId !== null && scopeId.trim() !== "") out.scopeId = scopeId;
  return out;
}

export function createAnswerHistoryRouteHandler(
  resolveProvider: () => AnswerClient,
): {
  list: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  showById: (
    id: string,
    req: IncomingMessage,
    res: ServerResponse,
  ) => Promise<void>;
} {
  return {
    async list(req: IncomingMessage, res: ServerResponse): Promise<void> {
      try {
        const query = parseListQuery(req);
        const selectedId = selectedScopeSelectorIdOrErrorResponse(res, query);
        if (selectedId === null) return;
        const filter = selectedId === undefined
          ? query
          : { ...query, scopeId: selectedId };
        jsonResponse(res, 200, await resolveProvider().log(filter));
      } catch (err) {
        if (err instanceof AnswerScopeSelectionError) {
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
    },
    async showById(
      id: string,
      req: IncomingMessage,
      res: ServerResponse,
    ): Promise<void> {
      try {
        const query = parseListQuery(req);
        const selectedId = selectedScopeSelectorIdOrErrorResponse(res, query);
        if (selectedId === null) return;
        const scope = selectedId === undefined ? undefined : { scopeId: selectedId };
        jsonResponse(res, 200, await resolveProvider().show(id, scope));
      } catch (err) {
        if (err instanceof AnswerScopeSelectionError) {
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
    },
  };
}
