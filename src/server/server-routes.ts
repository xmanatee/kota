import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { EventBus } from "../event-bus.js";
import type { AgentSession } from "../loop.js";
import { getHistory } from "../memory/history.js";
import type { RouteRegistration } from "../module-types.js";
import type { Scheduler } from "../scheduler/scheduler.js";
import { NullTransport, type Transport } from "../transport.js";
import { getWebUI } from "../web-ui/web-ui.js";
import type { NotificationHub } from "./server-notifications.js";
import {
  jsonResponse,
  type ManagedSession,
  readBody,
  type SessionPool,
  SseTransport,
  setCors,
} from "./session-pool.js";
import { handleTaskStatus } from "./task-routes.js";
import {
  handleWorkflowRunDetail,
  handleWorkflowRunStream,
  handleWorkflowRuns,
  handleWorkflowStatus,
} from "./workflow-routes.js";

export type ServerContext = {
  port: number;
  pool: SessionPool;
  scheduler: Scheduler;
  hub: NotificationHub;
  bus: EventBus;
  moduleRoutes: RouteRegistration[];
  makeAgent: (transport: Transport) => AgentSession;
};

export function readDaemonState(): { running: boolean; state: Record<string, unknown> } | null {
  const statePath = join(process.cwd(), ".kota", "daemon-state.json");
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

async function handleChat(req: IncomingMessage, res: ServerResponse, ctx: ServerContext): Promise<void> {
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
    const existing = ctx.pool.get(sessionId);
    if (!existing) {
      jsonResponse(res, 404, { error: "Session not found" });
      return;
    }
    session = existing;
  } else {
    try {
      session = ctx.pool.create(ctx.makeAgent);
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

    if (req.method === "GET" && path === "/api/health") {
      jsonResponse(res, 200, {
        status: "ok",
        sessions: ctx.pool.size,
        pendingSchedules: ctx.scheduler.count(),
      });
      return;
    }

    if (req.method === "GET" && path === "/api/sessions") {
      jsonResponse(res, 200, { sessions: ctx.pool.list() });
      return;
    }

    if (req.method === "POST" && path === "/api/sessions") {
      try {
        const session = ctx.pool.create(ctx.makeAgent);
        jsonResponse(res, 201, { session_id: session.id });
      } catch (err) {
        jsonResponse(res, 503, { error: (err as Error).message });
      }
      return;
    }

    if (req.method === "POST" && path === "/api/chat") {
      handleChat(req, res, ctx).catch((err) => {
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
      const deleted = ctx.pool.delete(deleteSessionMatch[1]);
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

    if (req.method === "GET" && path === "/api/tasks") {
      handleTaskStatus(res);
      return;
    }

    if (req.method === "GET" && path === "/api/workflow/status") {
      handleWorkflowStatus(res);
      return;
    }

    if (req.method === "GET" && path === "/api/workflow/runs") {
      handleWorkflowRuns(res, url);
      return;
    }

    const workflowRunStreamMatch = path.match(/^\/api\/workflow\/runs\/([^/]+)\/stream$/);
    if (req.method === "GET" && workflowRunStreamMatch) {
      handleWorkflowRunStream(res, workflowRunStreamMatch[1]);
      return;
    }

    const workflowRunMatch = path.match(/^\/api\/workflow\/runs\/([^/]+)$/);
    if (req.method === "GET" && workflowRunMatch) {
      handleWorkflowRunDetail(res, workflowRunMatch[1]);
      return;
    }

    if (req.method === "GET" && path === "/api/daemon/status") {
      const daemon = readDaemonState();
      jsonResponse(res, 200, {
        daemon: daemon ?? null,
        server: {
          sessions: ctx.pool.size,
          pendingSchedules: ctx.scheduler.count(),
          eventBusListeners: ctx.bus.listenerCount(),
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

    for (const route of ctx.moduleRoutes) {
      if (req.method === route.method && path === route.path) {
        Promise.resolve(route.handler(req, res)).catch((err) => {
          if (!res.headersSent) jsonResponse(res, 500, { error: (err as Error).message });
        });
        return;
      }
    }

    jsonResponse(res, 404, { error: "Not found" });
  };
}
