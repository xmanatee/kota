/**
 * HTTP routes for the cited-answer seam.
 *
 * `POST /answer` on the daemon-control server (capability scope `read`,
 * since the seam reads stores and runs one model call) and
 * `POST /api/answer` on the user-facing HTTP server share one handler
 * — the wire shape cannot drift between operator surfaces.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ControlRouteRegistration,
  RouteRegistration,
} from "#core/modules/module-types.js";
import type {
  AnswerFilter,
  AnswerResult,
  RecallSource,
} from "#core/server/kota-client.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
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
): ControlRouteRegistration[] {
  return [
    {
      method: "POST",
      path: "/answer",
      capabilityScope: "read",
      handler: createAnswerRouteHandler(resolveProvider),
    },
  ];
}

export function answerApiRoutes(
  resolveProvider: () => AnswerProvider,
): RouteRegistration[] {
  return [
    {
      method: "POST",
      path: "/api/answer",
      handler: createAnswerRouteHandler(resolveProvider),
    },
  ];
}
