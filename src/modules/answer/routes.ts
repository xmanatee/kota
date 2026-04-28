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
import type {
  AnswerFilter,
  AnswerHistoryListResult,
  AnswerHistoryShowResult,
  AnswerResult,
  RecallSource,
} from "#core/server/kota-client.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import type { AnswerHistoryStore } from "./answer-history-store.js";
import type { AnswerProvider } from "./answer-types.js";

const ALLOWED_SOURCES: ReadonlyArray<RecallSource> = [
  "knowledge",
  "memory",
  "history",
  "tasks",
];

function parseFilter(value: unknown): AnswerFilter | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const filter: AnswerFilter = {};
  if (typeof raw.topK === "number" && Number.isFinite(raw.topK)) {
    filter.topK = raw.topK;
  }
  if (typeof raw.minScore === "number" && Number.isFinite(raw.minScore)) {
    filter.minScore = raw.minScore;
  }
  if (Array.isArray(raw.sources)) {
    const sources = raw.sources.filter((s): s is RecallSource =>
      typeof s === "string" && (ALLOWED_SOURCES as readonly string[]).includes(s),
    );
    if (sources.length > 0) filter.sources = sources;
  }
  return filter;
}

export function createAnswerRouteHandler(
  resolveProvider: () => AnswerProvider,
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
    const query = typeof body.query === "string" ? body.query : "";
    if (query.trim() === "") {
      jsonResponse(res, 400, { error: "query is required" });
      return;
    }
    const filter = parseFilter(body.filter);
    try {
      const provider = resolveProvider();
      const result = await provider.answer(query, filter);
      jsonResponse(res, 200, result satisfies AnswerResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      jsonResponse(res, 500, { error: message });
    }
  };
}

export function answerControlRoutes(
  resolveProvider: () => AnswerProvider,
  resolveHistory: () => AnswerHistoryStore,
): ControlRouteRegistration[] {
  const historyHandlers = createAnswerHistoryRouteHandler(resolveHistory);
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
      handler: (_req, res, params) => historyHandlers.showById(params.id, res),
    },
  ];
}

export function answerApiRoutes(
  resolveProvider: () => AnswerProvider,
  resolveHistory: () => AnswerHistoryStore,
): RouteRegistration[] {
  const historyHandlers = createAnswerHistoryRouteHandler(resolveHistory);
  const showPathPattern = /^\/api\/answers\/([^/]+)$/;
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
      path: "/api/answers",
      pathPattern: showPathPattern,
      handler: async (req, res) => {
        const url = req.url ?? "";
        const pathname = url.split("?")[0] ?? "";
        const match = showPathPattern.exec(pathname);
        if (!match) {
          jsonResponse(res, 404, { error: "Not found" });
          return;
        }
        const id = decodeURIComponent(match[1] ?? "");
        await historyHandlers.showById(id, res);
      },
    },
  ];
}

type ListQuery = {
  limit?: number;
  beforeId?: string;
};

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
  return out;
}

export function createAnswerHistoryRouteHandler(
  resolveHistory: () => AnswerHistoryStore,
): {
  list: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  showById: (id: string, res: ServerResponse) => Promise<void>;
} {
  return {
    async list(req: IncomingMessage, res: ServerResponse): Promise<void> {
      try {
        const query = parseListQuery(req);
        const entries = await resolveHistory().listAnswers(query);
        const body: AnswerHistoryListResult = { entries };
        jsonResponse(res, 200, body);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        jsonResponse(res, 500, { error: message });
      }
    },
    async showById(id: string, res: ServerResponse): Promise<void> {
      try {
        const record = await resolveHistory().getAnswer(id);
        const body: AnswerHistoryShowResult = record
          ? { ok: true, record }
          : { ok: false, reason: "not_found" };
        jsonResponse(res, 200, body);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        jsonResponse(res, 500, { error: message });
      }
    },
  };
}
