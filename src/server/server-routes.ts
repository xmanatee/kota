import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { EventBus } from "../event-bus.js";
import type { RouteRegistration } from "../extension-types.js";
import type { AgentSession } from "../loop.js";
import type { Scheduler } from "../scheduler/scheduler.js";
import type { Transport } from "../transport.js";
import { getWebUI } from "../web-ui/web-ui.js";
import {
  handleApproveApproval,
  handleListApprovals,
  handleRejectApproval,
} from "./approval-routes.js";
import { handleDeleteHistory, handleGetHistory, handleListHistory } from "./history-routes.js";
import type { NotificationHub } from "./server-notifications.js";
import {
  jsonResponse,
  readBody,
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
import { handleTaskStatus } from "./task-routes.js";
import {
  handleWorkflowPause,
  handleWorkflowResume,
  handleWorkflowRunDetail,
  handleWorkflowRunStream,
  handleWorkflowRuns,
  handleWorkflowStatus,
  handleWorkflowTrigger,
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
      handleListSessions(res, ctx.pool);
      return;
    }

    if (req.method === "POST" && path === "/api/sessions") {
      handleCreateSession(res, ctx.pool, ctx.makeAgent);
      return;
    }

    if (req.method === "POST" && path === "/api/chat") {
      handleChat(req, res, ctx.pool, ctx.makeAgent).catch((err) => {
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
      handleDeleteSession(res, ctx.pool, deleteSessionMatch[1]);
      return;
    }

    if (req.method === "GET" && path === "/api/history") {
      handleListHistory(res, url);
      return;
    }

    const historyMatch = path.match(/^\/api\/history\/([^/]+)$/);
    if (req.method === "GET" && historyMatch) {
      handleGetHistory(res, historyMatch[1]);
      return;
    }

    if (req.method === "DELETE" && historyMatch) {
      handleDeleteHistory(req, res, historyMatch[1]);
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

    if (req.method === "GET" && path === "/api/approvals") {
      handleListApprovals(res);
      return;
    }

    const approvalActionMatch = path.match(/^\/api\/approvals\/([^/]+)\/(approve|reject)$/);
    if (req.method === "POST" && approvalActionMatch) {
      const approvalId = approvalActionMatch[1];
      const action = approvalActionMatch[2];
      if (action === "approve") {
        handleApproveApproval(res, approvalId);
      } else {
        handleRejectApproval(req, res, approvalId).catch((err) => {
          if (!res.headersSent) jsonResponse(res, 500, { error: (err as Error).message });
        });
      }
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

    if (req.method === "POST" && path === "/api/workflow/pause") {
      handleWorkflowPause(res);
      return;
    }

    if (req.method === "POST" && path === "/api/workflow/resume") {
      handleWorkflowResume(res);
      return;
    }

    if (req.method === "POST" && path === "/api/workflow/trigger") {
      handleWorkflowTrigger(req, res).catch((err) => {
        if (!res.headersSent) jsonResponse(res, 500, { error: (err as Error).message });
      });
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
