import type { IncomingMessage, ServerResponse } from "node:http";
import type { Scheduler } from "../core/daemon/scheduler.js";
import type { EventBus } from "../core/events/event-bus.js";
import type { AgentSession } from "../core/loop/loop.js";
import type { Transport } from "../core/loop/transport.js";
import type { RouteRegistration } from "../core/modules/module-types.js";
import { getWebUI } from "../web-ui/web-ui.js";
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
} from "./session-routes.js";

export type ServerContext = {
  port: number;
  pool: SessionPool;
  scheduler: Scheduler;
  hub: NotificationHub;
  bus: EventBus;
  moduleRoutes: RouteRegistration[];
  makeAgent: (transport: Transport) => AgentSession;
  daemonClient?: DaemonControlClient | null;
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
      const sessionId = handleCreateSession(res, ctx.pool, ctx.makeAgent);
      if (sessionId && ctx.daemonClient) {
        void ctx.daemonClient.registerSession(sessionId, new Date().toISOString());
      }
      return;
    }

    if (req.method === "POST" && path === "/api/chat") {
      const onSessionCreate = ctx.daemonClient
        ? (id: string) => { void ctx.daemonClient!.registerSession(id, new Date().toISOString()); }
        : undefined;
      handleChat(req, res, ctx.pool, ctx.makeAgent, onSessionCreate).catch((err) => {
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

    if (req.method === "GET" && (path === "/" || path === "/index.html")) {
      setCors(res);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(getWebUI());
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
