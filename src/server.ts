/**
 * HTTP API server — makes KOTA accessible via HTTP with SSE streaming.
 *
 * Enables web UIs, bots, and automation to interact with KOTA
 * without going through the CLI. Uses the Transport layer (iter 363)
 * for real, exercising it beyond CliTransport for the first time.
 */

import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { ActionExecutor } from "./action-executor.js";
import type { KotaConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { type EventBus, initEventBus, resetEventBus } from "./event-bus.js";
import { getHistory } from "./history.js";
import { AgentSession, type LoopOptions } from "./loop.js";
import { initModuleLogStore } from "./module-log.js";
import type { RouteRegistration } from "./module-types.js";
import { getScheduler, initScheduler, resetScheduler } from "./scheduler.js";
import { NotificationHub } from "./server-notifications.js";
import {
  CORS_HEADERS,
  jsonResponse,
  type ManagedSession,
  readBody,
  SessionPool,
  SseTransport,
  setCors,
} from "./session-pool.js";
import { NullTransport, type Transport } from "./transport.js";
import { getWebUI } from "./web-ui.js";

// Re-export for backwards compatibility with tests
export { type ManagedSession, SessionPool, SseTransport } from "./session-pool.js";

export type ServerOptions = {
  port?: number;
  model?: string;
  verbose?: boolean;
  config?: KotaConfig;
  /** Routes registered by modules (e.g., vercel-adapter). */
  moduleRoutes?: RouteRegistration[];
};

/** Read daemon state from disk. Returns null if unavailable. */
function readDaemonState(): { running: boolean; state: Record<string, unknown> } | null {
  const statePath = join(homedir(), ".kota", "daemon-state.json");
  if (!existsSync(statePath)) return null;
  try {
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    let running = false;
    if (state.pid && typeof state.pid === "number") {
      try {
        process.kill(state.pid, 0);
        running = true;
      } catch {
        running = false;
      }
    }
    return { running, state };
  } catch {
    return null;
  }
}

export function startServer(options: ServerOptions = {}): Server {
  const port = options.port ?? 3000;
  const config = options.config ?? loadConfig();
  const pool = new SessionPool();

  const bus = initEventBus();
  initScheduler(process.cwd());
  initModuleLogStore(process.cwd());
  const scheduler = getScheduler();

  const hub = new NotificationHub();

  const actionExecutor = new ActionExecutor({
    sessionOptions: {
      model: options.model ?? config.model,
      verbose: options.verbose ?? config.verbose,
      config,
    },
  });

  // Both bus-triggered and timer-triggered items use the same handler
  const stopBusConnection = scheduler.connectBus(bus, (dueItems) => {
    hub.handleDueItems(dueItems, actionExecutor);
  });

  const stopScheduler = scheduler.startTimer(30_000, (dueItems) => {
    hub.handleDueItems(dueItems, actionExecutor);
  });

  const cleanupTimer = setInterval(() => pool.cleanup(), 5 * 60 * 1000);
  cleanupTimer.unref();

  function makeAgent(transport: Transport): AgentSession {
    const loopOpts: LoopOptions = {
      model: options.model ?? config.model,
      verbose: options.verbose ?? config.verbose,
      transport,
      config,
    };
    return new AgentSession(loopOpts);
  }

  async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: Record<string, unknown>;
    try {
      body = await readBody(req);
    } catch (err) {
      jsonResponse(res, 400, { error: (err as Error).message });
      return;
    }

    const message = body.message as string | undefined;
    if (!message || typeof message !== "string") {
      jsonResponse(res, 400, { error: "message must be a non-empty string" });
      return;
    }

    let session: ManagedSession;
    const sessionId = body.session_id as string | undefined;
    if (sessionId) {
      const existing = pool.get(sessionId);
      if (!existing) {
        jsonResponse(res, 404, { error: "Session not found" });
        return;
      }
      session = existing;
    } else {
      try {
        session = pool.create(makeAgent);
      } catch (err) {
        jsonResponse(res, 503, { error: (err as Error).message });
        return;
      }
    }

    if (session.busy) {
      jsonResponse(res, 409, { error: "Session is busy processing another request" });
      return;
    }
    session.busy = true;

    await handleKotaChat(res, session, message);
  }

  async function handleKotaChat(res: ServerResponse, session: ManagedSession, message: string): Promise<void> {
    setCors(res);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sse = new SseTransport(res);
    session.proxy.target = sse;
    sse.send("session", { session_id: session.id });

    try {
      const result = await session.agent.send(message);
      sse.send("done", { session_id: session.id, result });
    } catch (err) {
      sse.send("error", { message: (err as Error).message });
    } finally {
      session.proxy.target = new NullTransport();
      session.busy = false;
      session.lastActive = Date.now();
      sse.end();
    }
  }

  async function handleEventTrigger(
    req: IncomingMessage,
    res: ServerResponse,
    eventBus: EventBus,
    eventName: string,
  ): Promise<void> {
    if (!eventName || eventName.length > 256) {
      jsonResponse(res, 400, { error: "Event name must be 1-256 characters" });
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = await readBody(req);
    } catch (err) {
      jsonResponse(res, 400, { error: (err as Error).message });
      return;
    }

    eventBus.emit(eventName, payload);
    jsonResponse(res, 200, {
      ok: true,
      event: eventName,
      listeners: eventBus.listenerCount(eventName) + eventBus.listenerCount("*"),
    });
  }

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    setCors(res);
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && path === "/api/health") {
      jsonResponse(res, 200, {
        status: "ok",
        sessions: pool.size,
        activeActions: actionExecutor.activeCount,
        pendingSchedules: scheduler.count(),
      });
      return;
    }

    if (req.method === "GET" && path === "/api/sessions") {
      jsonResponse(res, 200, { sessions: pool.list() });
      return;
    }

    if (req.method === "POST" && path === "/api/sessions") {
      try {
        const session = pool.create(makeAgent);
        jsonResponse(res, 201, { session_id: session.id });
      } catch (err) {
        jsonResponse(res, 503, { error: (err as Error).message });
      }
      return;
    }

    if (req.method === "POST" && path === "/api/chat") {
      handleChat(req, res).catch((err) => {
        if (!res.headersSent) {
          jsonResponse(res, 500, { error: (err as Error).message });
        }
      });
      return;
    }

    if (req.method === "GET" && path === "/api/schedules") {
      jsonResponse(res, 200, { schedules: scheduler.pending() });
      return;
    }

    if (req.method === "GET" && path === "/api/notifications") {
      setCors(res);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const sse = new SseTransport(res);
      hub.addClient(sse);
      res.on("close", () => hub.removeClient(sse));
      try {
        const overdue = scheduler.getDue();
        for (const item of overdue) {
          scheduler.markFired(item.id);
          sse.send("notification", {
            type: "reminder",
            id: item.id,
            description: item.description,
            scheduledFor: item.triggerAt,
            repeat: item.repeatLabel || null,
          });
        }
      } catch (err) {
        sse.send("error", { message: (err as Error).message });
      }
      sse.send("connected", { message: "Listening for notifications" });
      return;
    }

    const deleteMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
    if (req.method === "DELETE" && deleteMatch) {
      const deleted = pool.delete(deleteMatch[1]);
      if (deleted) {
        res.writeHead(204);
        res.end();
      } else {
        jsonResponse(res, 404, { error: "Session not found" });
      }
      return;
    }

    if (req.method === "GET" && path === "/api/history") {
      const history = getHistory();
      const search = url.searchParams.get("search") || undefined;
      const rawLimit = url.searchParams.has("limit") ? Number.parseInt(url.searchParams.get("limit")!, 10) : 20;
      const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 1000);
      jsonResponse(res, 200, { conversations: history.list({ search, limit }) });
      return;
    }

    const historyMatch = path.match(/^\/api\/history\/([^/]+)$/);
    if (req.method === "GET" && historyMatch) {
      const history = getHistory();
      const data = history.load(historyMatch[1]);
      if (data) {
        jsonResponse(res, 200, data);
      } else {
        jsonResponse(res, 404, { error: "Conversation not found" });
      }
      return;
    }

    if (req.method === "DELETE" && historyMatch) {
      const history = getHistory();
      if (history.remove(historyMatch[1])) {
        res.writeHead(204);
        res.end();
      } else {
        jsonResponse(res, 404, { error: "Conversation not found" });
      }
      return;
    }

    // --- Webhook / external trigger endpoints ---

    const eventMatch = path.match(/^\/api\/events\/([^/]+)$/);
    if (req.method === "POST" && eventMatch) {
      let eventName: string;
      try {
        eventName = decodeURIComponent(eventMatch[1]);
      } catch {
        jsonResponse(res, 400, { error: "Invalid event name encoding" });
        return;
      }
      handleEventTrigger(req, res, bus, eventName).catch((err) => {
        if (!res.headersSent) {
          jsonResponse(res, 500, { error: (err as Error).message });
        }
      });
      return;
    }

    if (req.method === "GET" && path === "/api/daemon/status") {
      const daemon = readDaemonState();
      jsonResponse(res, 200, {
        daemon: daemon ?? null,
        server: {
          sessions: pool.size,
          activeActions: actionExecutor.activeCount,
          pendingSchedules: scheduler.count(),
          eventBusListeners: bus.listenerCount(),
        },
      });
      return;
    }

    if (req.method === "GET" && (path === "/" || path === "/index.html")) {
      setCors(res);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(getWebUI());
      return;
    }

    // Module-registered routes (e.g., vercel-adapter)
    const moduleRoutes = options.moduleRoutes ?? [];
    for (const route of moduleRoutes) {
      if (req.method === route.method && path === route.path) {
        Promise.resolve(route.handler(req, res)).catch((err) => {
          if (!res.headersSent) {
            jsonResponse(res, 500, { error: (err as Error).message });
          }
        });
        return;
      }
    }

    jsonResponse(res, 404, { error: "Not found" });
  }

  const server = createServer(handleRequest);

  server.on("close", () => {
    clearInterval(cleanupTimer);
    stopBusConnection();
    stopScheduler();
    resetScheduler();
    resetEventBus();
    pool.closeAll();
  });

  server.listen(port, () => {
    console.log(`KOTA server listening on http://localhost:${port}`);
    console.log(`Web UI: http://localhost:${port}/`);
    console.log("API endpoints:");
    console.log("  POST /api/chat           — Send message (SSE streaming)");
    console.log("  POST /api/chat/vercel    — Vercel AI SDK Data Stream Protocol");
    console.log("  POST /api/sessions       — Create a new session");
    console.log("  GET  /api/sessions       — List active sessions");
    console.log("  DELETE /api/sessions/:id — Close a session");
    console.log("  GET  /api/schedules      — List pending scheduled items");
    console.log("  GET  /api/notifications  — SSE stream for due reminders");
    console.log("  GET  /api/history        — List conversation history");
    console.log("  GET  /api/history/:id    — Get conversation details");
    console.log("  DELETE /api/history/:id  — Delete a conversation");
    console.log("  POST /api/events/:name   — Fire a custom event (webhook trigger)");
    console.log("  GET  /api/daemon/status  — Daemon health and server status");
    console.log("  GET  /api/health         — Health check");
  });

  return server;
}
