import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join } from "node:path";
import type { Scheduler } from "#core/daemon/scheduler.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { AgentSession } from "#core/loop/loop.js";
import type { Transport } from "#core/loop/transport.js";
import type { RouteRegistration } from "#core/modules/module-types.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import { DaemonControlClient } from "./daemon-client.js";
import { queryDaemonStatus } from "./daemon-routes.js";
import { handleEventTrigger } from "./event-routes.js";
import type { NotificationHub } from "./server-notifications.js";
import {
  jsonResponse,
  type SessionPool,
  SseTransport,
  setCors,
} from "./session-pool.js";
import {
  handleChat,
  handleCreateSession,
  handleDeleteSession,
  handleListSessions,
  handlePatchSession,
} from "./session-routes.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export type ServerContext = {
  port: number;
  pool: SessionPool;
  scheduler: Scheduler;
  hub: NotificationHub;
  bus: EventBus;
  moduleRoutes: RouteRegistration[];
  makeAgent: (transport: Transport, autonomyMode: AutonomyMode) => AgentSession;
  /** Autonomy mode applied when a request does not specify one. */
  defaultAutonomyMode: AutonomyMode;
  daemonClient?: DaemonControlClient | null;
  /** Directory containing the built web UI static assets (index.html + assets/). */
  webUiDir?: string;
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

    if (req.method === "POST" && path === "/api/sessions") {
      handleCreateSession(req, res, ctx.pool, ctx.makeAgent, ctx.defaultAutonomyMode, (id) => {
        if (!ctx.daemonClient) return;
        const session = ctx.pool.get(id);
        if (!session) return;
        void ctx.daemonClient.registerSession(id, new Date().toISOString(), session.agent.getAutonomyMode());
      }).catch((err) => {
        if (!res.headersSent) jsonResponse(res, 500, { error: (err as Error).message });
      });
      return;
    }

    if (req.method === "POST" && path === "/api/chat") {
      const onSessionCreate = ctx.daemonClient
        ? (id: string) => {
            const session = ctx.pool.get(id);
            if (!session) return;
            void ctx.daemonClient!.registerSession(id, new Date().toISOString(), session.agent.getAutonomyMode());
          }
        : undefined;
      handleChat(req, res, ctx.pool, ctx.makeAgent, ctx.defaultAutonomyMode, onSessionCreate).catch((err) => {
        if (!res.headersSent) jsonResponse(res, 500, { error: (err as Error).message });
      });
      return;
    }

    if (req.method === "GET" && path === "/api/schedules") {
      jsonResponse(res, 200, { schedules: ctx.scheduler.pending() });
      return;
    }

    if (req.method === "GET" && path === "/api/notifications") {
      setCors(res);
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      const sse = new SseTransport(res);
      ctx.hub.addClient(sse);
      res.on("close", () => ctx.hub.removeClient(sse));
      try {
        for (const item of ctx.scheduler.getDue()) {
          ctx.scheduler.markFired(item.id);
          sse.send("notification", { type: "reminder", id: item.id, description: item.description, scheduledFor: item.triggerAt, repeat: item.repeatLabel || null });
        }
      } catch (err) {
        sse.send("error", { message: (err as Error).message });
      }
      sse.send("connected", { message: "Listening for notifications" });
      return;
    }

    const deleteSessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
    if (req.method === "DELETE" && deleteSessionMatch) {
      const sessionId = deleteSessionMatch[1];
      handleDeleteSession(res, ctx.pool, sessionId);
      if (ctx.daemonClient) {
        void ctx.daemonClient.unregisterSession(sessionId);
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

    const eventMatch = path.match(/^\/api\/events\/([^/]+)$/);
    if (req.method === "POST" && eventMatch) {
      let eventName: string;
      try {
        eventName = decodeURIComponent(eventMatch[1]);
      } catch {
        jsonResponse(res, 400, { error: "Invalid event name encoding" });
        return;
      }
      handleEventTrigger(req, res, ctx.bus, eventName).catch((err) => {
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

    if (req.method === "GET" && ctx.webUiDir) {
      if (path === "/" || path === "/index.html") {
        try {
          const html = readFileSync(join(ctx.webUiDir, "index.html"), "utf-8");
          setCors(res);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
        } catch {
          jsonResponse(res, 404, { error: "Web UI not installed" });
        }
        return;
      }
      if (path.startsWith("/assets/")) {
        const safePath = path.replace(/\.\./g, "");
        try {
          const data = readFileSync(join(ctx.webUiDir, safePath));
          const ext = extname(safePath);
          const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
          setCors(res);
          res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable" });
          res.end(data);
        } catch {
          jsonResponse(res, 404, { error: "Not found" });
        }
        return;
      }
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
