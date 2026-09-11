import type { IncomingMessage, ServerResponse } from "node:http";
import type { EventBus } from "#core/events/event-bus.js";
import type { AgentSession } from "#core/loop/loop.js";
import type { Transport } from "#core/loop/transport.js";
import type { RouteRegistration } from "#core/modules/module-types.js";
import { findRouteMatch } from "#core/modules/route-matcher.js";
import { normalizeScopeSelectorQueryUrl } from "#core/server/scope-selector.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { DaemonControlClient } from "./daemon-client.js";
import { withRouteErrorBoundary } from "./route-invocation.js";
import { jsonResponse, type SessionPool, setCors } from "./session-pool.js";
import {
  handleChat,
  handleCreateSession,
  handleDeleteSession,
  handleListSessions,
  handlePatchSession,
} from "./session-routes.js";

export type ServerContext = {
  port: number;
  pool: SessionPool;
  bus: EventBus;
  moduleRoutes: RouteRegistration[];
  makeAgent: (transport: Transport, autonomyMode: AutonomyMode) => AgentSession;
  /**
   * Lazy resolver for the autonomy mode applied when a request does not
   * specify one. Invoked per-request so that an unconfigured posture only
   * blocks session creation, not server boot.
   */
  resolveDefaultAutonomyMode: () => AutonomyMode;
  /**
   * Live accessor for the current daemon control client. Returns null when
   * no daemon is reachable. The indirection lets the server reconnect to a
   * daemon that restarts while serve is alive without stale handles.
   */
  getDaemonClient?: () => DaemonControlClient | null;
  /** Bearer token required on all /api/* requests. Undefined means no auth. */
  authToken?: string;
};

function normalizeMatchedRouteScopeSelectorQuery(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const normalized = normalizeScopeSelectorQueryUrl(
    new URL(req.url ?? "/", "http://localhost"),
  );
  if (!normalized.ok) {
    jsonResponse(res, normalized.status, normalized.body);
    return false;
  }
  if (normalized.changed) req.url = normalized.pathWithQuery;
  return true;
}

function isAuthorizedApiRequest(
  req: IncomingMessage,
  url: URL,
  authToken: string,
): boolean {
  if (req.headers.authorization === `Bearer ${authToken}`) return true;
  if (req.method !== "GET") return false;
  return url.searchParams.get("token") === authToken;
}

export function buildRequestHandler(ctx: ServerContext) {
  return withRouteErrorBoundary(async (req, res) => {
    setCors(res);
    const url = new URL(req.url ?? "/", `http://localhost:${ctx.port}`);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (ctx.authToken && path.startsWith("/api/")) {
      const moduleMatch = req.method ? findRouteMatch(ctx.moduleRoutes, req.method, path) : null;
      const isBypass = moduleMatch?.route.bypassAuth ?? false;
      if (!isBypass) {
        if (!isAuthorizedApiRequest(req, url, ctx.authToken)) {
          if (moduleMatch?.route.authFailureHandler) {
            await moduleMatch.route.authFailureHandler(req, res, moduleMatch.params);
            return;
          }
          jsonResponse(res, 401, { error: "Unauthorized" });
          return;
        }
      }
    }

    if (req.method === "GET" && path === "/api/health") {
      jsonResponse(res, 200, {
        status: "ok",
        sessions: ctx.pool.size,
      });
      return;
    }

    if (req.method === "GET" && path === "/api/sessions") {
      handleListSessions(res, ctx.pool);
      return;
    }

    const registerSessionWithDaemon = (id: string): void => {
      const client = ctx.getDaemonClient?.();
      if (!client) return;
      const session = ctx.pool.get(id);
      if (!session) return;
      void client.registerSession(id, session.createdAt, session.agent.getAutonomyMode());
    };

    if (req.method === "POST" && path === "/api/sessions") {
      await handleCreateSession(req, res, ctx.pool, ctx.makeAgent, ctx.resolveDefaultAutonomyMode, registerSessionWithDaemon);
      return;
    }

    if (req.method === "POST" && path === "/api/chat") {
      await handleChat(req, res, ctx.pool, ctx.makeAgent, ctx.resolveDefaultAutonomyMode, registerSessionWithDaemon);
      return;
    }

    const deleteSessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
    if (req.method === "DELETE" && deleteSessionMatch) {
      const sessionId = deleteSessionMatch[1];
      handleDeleteSession(res, ctx.pool, sessionId);
      const client = ctx.getDaemonClient?.();
      if (client) {
        void client.unregisterSession(sessionId);
      }
      return;
    }

    const patchSessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
    if (req.method === "PATCH" && patchSessionMatch) {
      await handlePatchSession(req, res, ctx.pool, patchSessionMatch[1]);
      return;
    }

    if (req.method === "GET" && path === "/api/daemon/events") {
      // Reuse the live daemon client assembled by DaemonLink — it carries
      // the module-contributed daemon handlers needed to satisfy
      // assembleDaemonClientHandlers' coverage check. Falling back to
      // DaemonControlClient.fromStateDir() here would re-assemble the
      // client without contributed handlers and fail loudly for migrated
      // namespaces.
      const client = ctx.getDaemonClient?.() ?? null;
      if (!client) {
        jsonResponse(res, 503, { error: "Daemon not running" });
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      const controller = new AbortController();
      const after = new URL(req.url ?? "/", "http://localhost").searchParams.get("after");
      const gen = client.events({ signal: controller.signal, ...(after ? { after } : {}) });
      res.once("close", () => controller.abort());
      try {
        for await (const event of gen) {
          if (res.destroyed) break;
          res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
        }
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        controller.abort();
        res.end();
      }
      return;
    }

    if (req.method === "GET" && path === "/api/daemon/status") {
      const client = ctx.getDaemonClient?.() ?? null;
      const daemon = client ? await client.getDaemonStatus() : null;
      jsonResponse(res, 200, {
        daemon,
        server: {
          sessions: ctx.pool.size,
          eventBusListeners: ctx.bus.listenerCount(),
        },
      });
      return;
    }

    if (req.method) {
      const match = findRouteMatch(ctx.moduleRoutes, req.method, path);
      if (match) {
        if (!normalizeMatchedRouteScopeSelectorQuery(req, res)) return;
        await match.route.handler(req, res, match.params);
        return;
      }
    }

    jsonResponse(res, 404, { error: "Not found" });
  });
}
