import type { IncomingMessage, ServerResponse } from "node:http";
import type { EventBus } from "../event-bus.js";
import type { ExtensionSummary, RouteRegistration } from "../extension-types.js";
import type { AgentSession } from "../loop.js";
import type { Scheduler } from "../scheduler/scheduler.js";
import type { Transport } from "../transport.js";
import { getWebUI } from "../web-ui/web-ui.js";
import { WorkflowRunStore } from "../workflow/run-store.js";
import {
  handleApproveApproval,
  handleListApprovals,
  handleRejectApproval,
} from "./approval-routes.js";
import { handleListAudit } from "./audit-routes.js";
import { DaemonControlClient } from "./daemon-client.js";
import { queryDaemonStatus } from "./daemon-routes.js";
import { handleEventTrigger } from "./event-routes.js";
import { handleListExtensions } from "./extension-routes.js";
import { handleDeleteHistory, handleGetHistory, handleListHistory } from "./history-routes.js";
import { handleGetKnowledge, handleListKnowledge } from "./knowledge-routes.js";
import { handleGetMemory, handleListMemory } from "./memory-routes.js";
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
import { handleTaskStatus } from "./task-routes.js";
import {
  handleWorkflowAbort,
  handleWorkflowCancel,
  handleWorkflowDefinitions,
  handleWorkflowPause,
  handleWorkflowResume,
  handleWorkflowRetry,
  handleWorkflowStatus,
  handleWorkflowTrigger,
} from "./workflow-routes.js";
import {
  handleWorkflowRunArtifacts,
  handleWorkflowRunDetail,
  handleWorkflowRunStream,
  handleWorkflowRuns,
} from "./workflow-run-routes.js";

export type ServerContext = {
  port: number;
  pool: SessionPool;
  scheduler: Scheduler;
  hub: NotificationHub;
  bus: EventBus;
  extensionRoutes: RouteRegistration[];
  makeAgent: (transport: Transport) => AgentSession;
  daemonClient?: DaemonControlClient | null;
  /** Returns current extension summaries for /api/extensions. */
  getExtensionSummaries?: () => ExtensionSummary[];
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
      const header = req.headers.authorization;
      const queryToken = url.searchParams.get("token");
      if (header !== `Bearer ${ctx.authToken}` && queryToken !== ctx.authToken) {
        jsonResponse(res, 401, { error: "Unauthorized" });
        return;
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

    if (req.method === "GET" && path === "/api/history") {
      handleListHistory(res, url, DaemonControlClient.fromStateDir()).catch((err) => {
        if (!res.headersSent) jsonResponse(res, 500, { error: (err as Error).message });
      });
      return;
    }

    const historyMatch = path.match(/^\/api\/history\/([^/]+)$/);
    if (req.method === "GET" && historyMatch) {
      handleGetHistory(res, historyMatch[1], DaemonControlClient.fromStateDir()).catch((err) => {
        if (!res.headersSent) jsonResponse(res, 500, { error: (err as Error).message });
      });
      return;
    }

    if (req.method === "DELETE" && historyMatch) {
      handleDeleteHistory(req, res, historyMatch[1], DaemonControlClient.fromStateDir()).catch((err) => {
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

    if (req.method === "GET" && path === "/api/approvals") {
      handleListApprovals(res, DaemonControlClient.fromStateDir()).catch((err) => {
        if (!res.headersSent) jsonResponse(res, 500, { error: (err as Error).message });
      });
      return;
    }

    const approvalActionMatch = path.match(/^\/api\/approvals\/([^/]+)\/(approve|reject)$/);
    if (req.method === "POST" && approvalActionMatch) {
      const approvalId = approvalActionMatch[1];
      const action = approvalActionMatch[2];
      if (action === "approve") {
        handleApproveApproval(res, approvalId, DaemonControlClient.fromStateDir()).catch((err) => {
          if (!res.headersSent) jsonResponse(res, 500, { error: (err as Error).message });
        });
      } else {
        handleRejectApproval(req, res, approvalId, DaemonControlClient.fromStateDir()).catch((err) => {
          if (!res.headersSent) jsonResponse(res, 500, { error: (err as Error).message });
        });
      }
      return;
    }

    if (req.method === "GET" && path === "/api/tasks") {
      handleTaskStatus(res, DaemonControlClient.fromStateDir()).catch((err) => {
        if (!res.headersSent) jsonResponse(res, 500, { error: (err as Error).message });
      });
      return;
    }

    if (req.method === "GET" && path === "/api/extensions") {
      handleListExtensions(res, ctx.getExtensionSummaries ? ctx.getExtensionSummaries() : []);
      return;
    }

    if (req.method === "GET" && path === "/api/knowledge") {
      handleListKnowledge(res);
      return;
    }

    const knowledgeEntryMatch = path.match(/^\/api\/knowledge\/([^/]+)$/);
    if (req.method === "GET" && knowledgeEntryMatch) {
      handleGetKnowledge(res, knowledgeEntryMatch[1]);
      return;
    }

    if (req.method === "GET" && path === "/api/memory") {
      handleListMemory(res);
      return;
    }

    const memoryEntryMatch = path.match(/^\/api\/memory\/([^/]+)$/);
    if (req.method === "GET" && memoryEntryMatch) {
      handleGetMemory(res, memoryEntryMatch[1]);
      return;
    }

    if (req.method === "GET" && path === "/api/audit") {
      handleListAudit(req, res);
      return;
    }

    if (req.method === "GET" && path === "/api/workflow/status") {
      handleWorkflowStatus(res, DaemonControlClient.fromStateDir()).catch((err) => {
        if (!res.headersSent) jsonResponse(res, 500, { error: (err as Error).message });
      });
      return;
    }

    if (req.method === "GET" && path === "/api/workflow/definitions") {
      handleWorkflowDefinitions(res, DaemonControlClient.fromStateDir()).catch((err) => {
        if (!res.headersSent) jsonResponse(res, 500, { error: (err as Error).message });
      });
      return;
    }

    if (req.method === "POST" && path === "/api/workflow/pause") {
      handleWorkflowPause(res, DaemonControlClient.fromStateDir()).catch((err) => {
        if (!res.headersSent) jsonResponse(res, 500, { error: (err as Error).message });
      });
      return;
    }

    if (req.method === "POST" && path === "/api/workflow/resume") {
      handleWorkflowResume(res, DaemonControlClient.fromStateDir()).catch((err) => {
        if (!res.headersSent) jsonResponse(res, 500, { error: (err as Error).message });
      });
      return;
    }

    if (req.method === "POST" && path === "/api/workflow/abort") {
      handleWorkflowAbort(res, DaemonControlClient.fromStateDir()).catch((err) => {
        if (!res.headersSent) jsonResponse(res, 500, { error: (err as Error).message });
      });
      return;
    }

    if (req.method === "POST" && path === "/api/workflow/retry") {
      handleWorkflowRetry(
        req,
        res,
        new WorkflowRunStore(),
        DaemonControlClient.fromStateDir(),
      ).catch((err) => {
        if (!res.headersSent) jsonResponse(res, 500, { error: (err as Error).message });
      });
      return;
    }

    if (req.method === "POST" && path === "/api/workflow/trigger") {
      handleWorkflowTrigger(
        req,
        res,
        new WorkflowRunStore(),
        DaemonControlClient.fromStateDir(),
      ).catch((err) => {
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

    const workflowRunArtifactsMatch = path.match(/^\/api\/workflow\/runs\/([^/]+)\/artifacts$/);
    if (req.method === "GET" && workflowRunArtifactsMatch) {
      handleWorkflowRunArtifacts(res, workflowRunArtifactsMatch[1]);
      return;
    }

    const workflowRunMatch = path.match(/^\/api\/workflow\/runs\/([^/]+)$/);
    if (req.method === "GET" && workflowRunMatch) {
      handleWorkflowRunDetail(res, workflowRunMatch[1]);
      return;
    }

    if (req.method === "DELETE" && workflowRunMatch) {
      handleWorkflowCancel(res, workflowRunMatch[1], DaemonControlClient.fromStateDir()).catch((err) => {
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

    for (const route of ctx.extensionRoutes) {
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
