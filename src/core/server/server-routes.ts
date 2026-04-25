import type { IncomingMessage, ServerResponse } from "node:http";
import type { Scheduler } from "#core/daemon/scheduler.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { AgentSession } from "#core/loop/loop.js";
import type { Transport } from "#core/loop/transport.js";
import type { RouteRegistration } from "#core/modules/module-types.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import { DaemonControlClient } from "./daemon-client.js";
import { queryDaemonStatus } from "./daemon-routes.js";
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
  scheduler: Scheduler;
  bus: EventBus;
  moduleRoutes: RouteRegistration[];
  makeAgent: (transport: Transport, autonomyMode: AutonomyMode) => AgentSession;
  /** Autonomy mode applied when a request does not specify one. */
  defaultAutonomyMode: AutonomyMode;
  /**
   * Live accessor for the current daemon control client. Returns null when
   * no daemon is reachable. The indirection lets the server reconnect to a
   * daemon that restarts while serve is alive without stale handles.
   */
  getDaemonClient?: () => DaemonControlClient | null;
  /** Bearer token required on all /api/* requests. Undefined means no auth. */
  authToken?: string;
};

export function buildRequestHandler(ctx: ServerContext) {
  return function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    setCors(res);
    const url = new URL(req.url ?? "/", `http://localhost:${ctx.port}`);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (ctx.authToken && path.startsWith("/api/")) {
      const bypassRoute = ctx.moduleRoutes.find(
        (r) => r.bypassAuth && r.path === path && r.method === req.method,
      );
      if (!bypassRoute) {
        const header = req.headers.authorization;
        const queryToken = url.searchParams.get("token");
        if (header !== `Bearer ${ctx.authToken}` && queryToken !== ctx.authToken) {
          jsonResponse(res, 401, { error: "Unauthorized" });
          return;
        }
      }
    }

    if (req.method === "GET" && path === "/api/health") {
      jsonResponse(res, 200, {
        status: "ok",
        sessions: ctx.pool.size,
        pendingSchedules: ctx.scheduler.count(),
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
      handleCreateSession(req, res, ctx.pool, ctx.makeAgent, ctx.defaultAutonomyMode, registerSessionWithDaemon).catch((err) => {
        if (!res.headersSent) jsonResponse(res, 500, { error: (err as Error).message });
      });
      return;
    }

    if (req.method === "POST" && path === "/api/chat") {
      handleChat(req, res, ctx.pool, ctx.makeAgent, ctx.defaultAutonomyMode, registerSessionWithDaemon).catch((err) => {
        if (!res.headersSent) jsonResponse(res, 500, { error: (err as Error).message });
      });
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
      handlePatchSession(req, res, ctx.pool, patchSessionMatch[1]).catch((err) => {
        if (!res.headersSent) jsonResponse(res, 500, { error: (err as Error).message });
      });
      return;
    }

    if (req.method === "GET" && path === "/api/daemon/events") {
      const client = DaemonControlClient.fromStateDir();
      if (!client) {
        jsonResponse(res, 503, { error: "Daemon not running" });
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      const gen = client.events();
      req.on("close", () => { void gen.return(undefined); });
      void (async () => {
        for await (const event of gen) {
          if (res.destroyed) break;
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
        }
      })();
      return;
    }

    if (req.method === "GET" && path === "/api/daemon/status") {
      queryDaemonStatus().then((daemon) => {
        jsonResponse(res, 200, {
          daemon: daemon ?? null,
          server: {
            sessions: ctx.pool.size,
            pendingSchedules: ctx.scheduler.count(),
            eventBusListeners: ctx.bus.listenerCount(),
          },
        });
      }).catch((err) => {
        if (!res.headersSent) jsonResponse(res, 500, { error: (err as Error).message });
      });
      return;
    }

    for (const route of ctx.moduleRoutes) {
      if (req.method === route.method && (route.pathPattern ? route.pathPattern.test(path) : path === route.path)) {
        Promise.resolve(route.handler(req, res)).catch((err) => {
          if (!res.headersSent) jsonResponse(res, 500, { error: (err as Error).message });
        });
        return;
      }
    }

    jsonResponse(res, 404, { error: "Not found" });
  };
}
