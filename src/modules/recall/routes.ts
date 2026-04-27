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
import type {
  RecallFilter,
  RecallResult,
  RecallSource,
} from "#core/server/kota-client.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import type { RecallProvider } from "./recall-types.js";

const ALLOWED_SOURCES: ReadonlyArray<RecallSource> = [
  "knowledge",
  "memory",
  "history",
  "tasks",
];

function parseFilter(value: unknown): RecallFilter | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const filter: RecallFilter = {};
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
    const query = typeof body.query === "string" ? body.query : "";
    if (query.trim() === "") {
      jsonResponse(res, 400, { error: "query is required" });
      return;
    }
    const filter = parseFilter(body.filter);
    try {
      const provider = resolveProvider();
      if (provider.contributors().length === 0) {
        jsonResponse(res, 200, {
          ok: false,
          reason: "semantic_unavailable",
        } satisfies RecallResult);
        return;
      }
      const hits = await provider.recall(query, filter);
      jsonResponse(res, 200, { ok: true, hits } satisfies RecallResult);
    } catch (err) {
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
