import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AgentSession } from "#core/loop/loop.js";
import type { Transport } from "#core/loop/transport.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import { handleApproveAllApprovals, handleApproveApproval, handleListApprovals, handleRejectAllApprovals, handleRejectApproval } from "./daemon-control-approvals.js";
import {
  DaemonChatPool,
  type DaemonChatPoolOptions,
  deleteDaemonSession,
  handleCreateDaemonSession,
  handleDaemonChat,
  handlePatchDaemonSession,
} from "./daemon-control-chat.js";
import { handleDeleteHistory, handleGetHistory, handleListHistory } from "./daemon-control-history.js";
import { handleMetrics } from "./daemon-control-metrics.js";
import { handleAnswerOwnerQuestion, handleDismissOwnerQuestion, handleListOwnerQuestions } from "./daemon-control-owner-questions.js";
import { handleRegisterPushToken } from "./daemon-control-push-tokens.js";
import { handleListSessions, handleRegisterSession, handleUnregisterSession } from "./daemon-control-sessions.js";
import type { DaemonControlHandle, DaemonLiveStatus, DaemonSseEvent } from "./daemon-control-types.js";
import { jsonResponse } from "./daemon-control-utils.js";
import { handleWebhookRequest } from "./daemon-control-webhook.js";
import {
  handleAbortWorkflow,
  handleAbortWorkflowRun,
  handleCancelWorkflowRun,
  handleDisableWorkflow,
  handleEnableWorkflow,
  handleGetWorkflowDefinitions,
  handleGetWorkflowRun,
  handleGetWorkflowStatus,
  handleListWorkflowRuns,
  handlePauseWorkflow,
  handleReloadConfig,
  handleReloadWorkflow,
  handleResumeWorkflow,
  handleTriggerWorkflow,
} from "./daemon-control-workflow.js";
import { EventRingBuffer } from "./event-ring-buffer.js";

export type {
  CapabilityScope,
  ComponentStatus,
  DaemonControlAddress,
  DaemonControlHandle,
  DaemonLiveStatus,
  DaemonSseEvent,
  DaemonSseEventType,
  HealthStatus,
  InteractiveSession,
  WorkflowCostEntry,
  WorkflowDefinitionSummary,
  WorkflowDefinitionTriggerSummary,
  WorkflowDurationHistogramEntry,
  WorkflowLiveStatus,
  WorkflowMetricCounts,
  WorkflowRunCountEntry,
  WorkflowRunDetail,
  WorkflowRunStepSummary,
  WorkflowRunSummary,
} from "./daemon-control-types.js";

// Map each route key (method + " " + path pattern) to its required capability scope.
const ROUTE_SCOPES: Record<string, "read" | "control"> = {
  "GET /status": "read",
  "GET /workflow/status": "read",
  "GET /events": "read",
  "GET /api/events": "read",
  "POST /workflow/trigger": "control",
  "POST /workflow/pause": "control",
  "POST /workflow/resume": "control",
  "POST /workflow/abort": "control",
  "POST /workflow/reload": "control",
  "POST /reload": "control",
  "GET /history": "read",
  "GET /history/:id": "read",
  "DELETE /history/:id": "control",
  "GET /approvals": "read",
  "POST /approvals/:id/approve": "control",
  "POST /approvals/:id/reject": "control",
  "POST /approvals/approve-all": "control",
  "POST /approvals/reject-all": "control",
  "GET /owner-questions": "read",
  "POST /owner-questions/:id/answer": "control",
  "POST /owner-questions/:id/dismiss": "control",
  "GET /workflow/definitions": "read",
  "POST /workflow/definitions/:name/disable": "control",
  "POST /workflow/definitions/:name/enable": "control",
  "GET /workflow/runs": "read",
  "GET /workflow/runs/:id": "read",
  "DELETE /workflow/runs/:id": "control",
  "POST /workflow/runs/:id/abort": "control",
  "GET /sessions": "read",
  "POST /sessions": "control",
  "POST /sessions/register": "control",
  "POST /sessions/:id/chat": "control",
  "PATCH /sessions/:id": "control",
  "DELETE /sessions/:id": "control",
  "GET /metrics": "read",
  "POST /push-tokens": "control",
};

function extractParams(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split("/");
  const pathParts = path.split("/");
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

function matchRouteKey(
  method: string,
  path: string,
): { key: string; params: Record<string, string> } | null {
  const exactKey = `${method} ${path}`;
  if (exactKey in ROUTE_SCOPES) return { key: exactKey, params: {} };
  for (const key of Object.keys(ROUTE_SCOPES)) {
    if (!key.startsWith(`${method} `)) continue;
    const pattern = key.slice(method.length + 1);
    if (!pattern.includes(":")) continue;
    const params = extractParams(pattern, path);
    if (params) return { key, params };
  }
  return null;
}

export type DaemonControlServerOptions = {
  /** Maximum number of events retained in the in-memory ring buffer. Default: 500. */
  eventBufferSize?: number;
  /**
   * When provided, enables POST /sessions, POST /sessions/:id/chat for daemon-owned sessions.
   * The factory receives the proxy transport and the session's autonomy mode.
   */
  makeAgent?: (transport: Transport, autonomyMode: AutonomyMode) => AgentSession;
  /** Autonomy mode used when POST /sessions does not specify one. */
  defaultAutonomyMode?: AutonomyMode;
  /** Options forwarded to the daemon chat session pool. */
  chatPool?: DaemonChatPoolOptions;
};

export class DaemonControlServer {
  private server: Server | null = null;
  private port: number | null = null;
  private sseClients = new Set<ServerResponse>();
  private unsubscribeEvents: (() => void) | null = null;
  private readonly eventBuffer: EventRingBuffer;
  private readonly chatPool: DaemonChatPool | null;
  private readonly makeAgent: ((transport: Transport, autonomyMode: AutonomyMode) => AgentSession) | null;
  private readonly defaultAutonomyMode: AutonomyMode | undefined;
  private readonly chatSweepMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly handle: DaemonControlHandle,
    private readonly token?: string,
    options?: DaemonControlServerOptions,
  ) {
    this.eventBuffer = new EventRingBuffer(options?.eventBufferSize ?? 500);
    this.makeAgent = options?.makeAgent ?? null;
    this.defaultAutonomyMode = options?.defaultAutonomyMode;
    this.chatPool = this.makeAgent ? new DaemonChatPool(options?.chatPool) : null;
    const ttlMs = options?.chatPool?.ttlMs ?? (5 * 60 * 1000);
    this.chatSweepMs = Math.min(ttlMs, 60_000);
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = createServer((req, res) => {
        this.handleRequest(req, res);
      });
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address() as { port: number };
        this.server = srv;
        this.port = addr.port;
        this.unsubscribeEvents = this.handle.subscribeToEvents((event) => {
          this.eventBuffer.push(event);
          this.broadcast(event);
        });
        if (this.chatPool) {
          this.cleanupTimer = setInterval(() => { this.chatPool!.cleanup(); }, this.chatSweepMs);
        }
        resolve(addr.port);
      });
      srv.once("error", reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.cleanupTimer !== null) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
      }
      this.chatPool?.closeAll();
      this.unsubscribeEvents?.();
      this.unsubscribeEvents = null;
      for (const res of this.sseClients) {
        if (!res.writableEnded) res.end();
      }
      this.sseClients.clear();
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }

  getPort(): number | null {
    return this.port;
  }

  private isAuthorized(req: IncomingMessage): boolean {
    if (!this.token) return true;
    const header = req.headers.authorization ?? "";
    return header === `Bearer ${this.token}`;
  }

  private broadcast(event: DaemonSseEvent): void {
    const chunk = `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
    for (const res of this.sseClients) {
      try {
        res.write(chunk);
      } catch {
        this.sseClients.delete(res);
      }
    }
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const method = req.method ?? "GET";

    // Health check requires no auth — must be checked before auth middleware.
    if (method === "GET" && path === "/health") {
      const health = this.handle.getHealthStatus();
      const state = this.handle.getDaemonLiveState();
      const uptimeMs = Date.now() - new Date(state.startedAt).getTime();
      const degraded = health.scheduler === "error" || health.modules === "error";
      jsonResponse(res, degraded ? 503 : 200, {
        status: degraded ? "degraded" : "ok",
        version: "0.1.0",
        uptimeMs,
        components: health,
      });
      return;
    }

    // Webhook triggers use their own secret auth, not the daemon Bearer token.
    if (method === "POST" && path.startsWith("/webhooks/")) {
      const workflowName = decodeURIComponent(path.slice("/webhooks/".length));
      handleWebhookRequest(this.handle, req, res, workflowName);
      return;
    }

    const match = matchRouteKey(method, path);
    if (!match) {
      jsonResponse(res, 404, { error: "Not found" });
      return;
    }

    if (!this.isAuthorized(req)) {
      jsonResponse(res, 401, { error: "Unauthorized" });
      return;
    }

    const { params } = match;
    const h = this.handle;

    if (method === "GET" && path === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(":\n\n");

      const sinceParam = url.searchParams.get("since");
      if (sinceParam) {
        const sinceMs = new Date(sinceParam).getTime();
        if (!Number.isNaN(sinceMs)) {
          for (const { event } of this.eventBuffer.query(sinceMs)) {
            res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
          }
        }
      }

      this.sseClients.add(res);
      req.on("close", () => { this.sseClients.delete(res); });
      return;
    }

    if (method === "GET" && path === "/api/events") {
      const sinceParam = url.searchParams.get("since");
      const limitParam = url.searchParams.get("limit");
      const typeParam = url.searchParams.get("type");
      const sinceMs = sinceParam ? new Date(sinceParam).getTime() : undefined;
      const limit = limitParam ? parseInt(limitParam, 10) : undefined;
      let entries = this.eventBuffer.query(
        sinceMs != null && !Number.isNaN(sinceMs) ? sinceMs : undefined,
        limit == null || typeParam != null ? undefined : limit,
      );
      if (typeParam) {
        const isGlob = typeParam.includes("*");
        if (isGlob) {
          const re = new RegExp(`^${typeParam.replace(/\./g, "\\.").replace(/\*/g, ".*")}$`);
          entries = entries.filter(({ event }) => re.test(event.type));
        } else {
          entries = entries.filter(({ event }) => event.type.startsWith(typeParam));
        }
        if (limit != null && entries.length > limit) {
          entries = entries.slice(entries.length - limit);
        }
      }
      jsonResponse(res, 200, {
        events: entries.map(({ event, timestamp }) => ({
          type: event.type,
          payload: event.payload,
          timestamp: new Date(timestamp).toISOString(),
        })),
      });
      return;
    }

    if (method === "GET" && path === "/status") {
      const daemonState = h.getDaemonLiveState();
      const workflowStatus = h.getWorkflowLiveStatus();
      const sessions = h.listSessions();
      const body: DaemonLiveStatus = { ...daemonState, workflow: workflowStatus, sessions };
      jsonResponse(res, 200, body);
      return;
    }

    if (method === "GET" && path === "/workflow/status") { handleGetWorkflowStatus(h, res); return; }
    if (method === "GET" && path === "/workflow/definitions") { handleGetWorkflowDefinitions(h, res); return; }
    if (method === "POST" && params.name && path.endsWith("/disable") && path.startsWith("/workflow/definitions/")) { handleDisableWorkflow(h, res, params); return; }
    if (method === "POST" && params.name && path.endsWith("/enable") && path.startsWith("/workflow/definitions/")) { handleEnableWorkflow(h, res, params); return; }
    if (method === "GET" && path === "/workflow/runs") { handleListWorkflowRuns(h, res, url); return; }
    if (method === "GET" && params.id && path.startsWith("/workflow/runs/")) { handleGetWorkflowRun(h, res, params); return; }
    if (method === "DELETE" && params.id && path.startsWith("/workflow/runs/")) { handleCancelWorkflowRun(h, res, params); return; }
    if (method === "POST" && params.id && path.endsWith("/abort") && path.startsWith("/workflow/runs/")) { handleAbortWorkflowRun(h, res, params); return; }
    if (method === "POST" && path === "/workflow/pause") { handlePauseWorkflow(h, res); return; }
    if (method === "POST" && path === "/workflow/resume") { handleResumeWorkflow(h, res); return; }
    if (method === "POST" && path === "/workflow/abort") { handleAbortWorkflow(h, res); return; }
    if (method === "POST" && path === "/workflow/reload") { handleReloadWorkflow(h, res); return; }
    if (method === "POST" && path === "/reload") { handleReloadConfig(h, res); return; }
    if (method === "POST" && path === "/workflow/trigger") { handleTriggerWorkflow(h, req, res); return; }

    if (method === "GET" && path === "/history") { handleListHistory(h, res, url); return; }
    if (method === "GET" && params.id && path.startsWith("/history/")) { handleGetHistory(h, res, params); return; }
    if (method === "DELETE" && params.id && path.startsWith("/history/")) { handleDeleteHistory(h, req, res, params); return; }

    if (method === "GET" && path === "/approvals") { handleListApprovals(h, res); return; }
    if (method === "POST" && path === "/approvals/approve-all") { handleApproveAllApprovals(h, req, res); return; }
    if (method === "POST" && path === "/approvals/reject-all") { handleRejectAllApprovals(h, req, res); return; }
    if (method === "POST" && params.id && path.startsWith("/approvals/") && path.endsWith("/approve")) { handleApproveApproval(h, req, res, params); return; }
    if (method === "POST" && params.id && path.startsWith("/approvals/") && path.endsWith("/reject")) { handleRejectApproval(h, req, res, params); return; }

    if (method === "GET" && path === "/owner-questions") { handleListOwnerQuestions(h, res); return; }
    if (method === "POST" && params.id && path.startsWith("/owner-questions/") && path.endsWith("/answer")) { handleAnswerOwnerQuestion(h, req, res, params); return; }
    if (method === "POST" && params.id && path.startsWith("/owner-questions/") && path.endsWith("/dismiss")) { handleDismissOwnerQuestion(h, req, res, params); return; }

    if (method === "GET" && path === "/sessions") {
      if (this.chatPool) {
        const daemonEntries = this.chatPool.list();
        const daemonIds = new Set(daemonEntries.map((s) => s.id));
        const serveSessions = h
          .listSessions()
          .filter((s) => !daemonIds.has(s.id))
          .map((s) => ({ ...s, source: "serve" as const }));
        jsonResponse(res, 200, { sessions: [...serveSessions, ...daemonEntries] });
      } else {
        handleListSessions(h, res);
      }
      return;
    }
    if (method === "POST" && path === "/sessions") {
      if (!this.chatPool || !this.makeAgent) {
        jsonResponse(res, 503, { error: "Daemon chat sessions not available" });
      } else {
        handleCreateDaemonSession(this.chatPool, req, res, this.makeAgent, this.defaultAutonomyMode).catch((err: Error) => {
          if (!res.headersSent) jsonResponse(res, 500, { error: err.message });
        });
      }
      return;
    }
    if (method === "POST" && path === "/sessions/register") { handleRegisterSession(h, req, res); return; }
    if (method === "PATCH" && params.id && path.startsWith("/sessions/") && !path.endsWith("/chat")) {
      handlePatchDaemonSession(
        this.chatPool,
        (id, mode) => h.setSessionAutonomyMode(id, mode),
        req,
        res,
        params.id,
      ).catch((err: Error) => {
        if (!res.headersSent) jsonResponse(res, 500, { error: err.message });
      });
      return;
    }
    if (method === "POST" && params.id && path.endsWith("/chat") && path.startsWith("/sessions/")) {
      if (!this.chatPool) {
        jsonResponse(res, 503, { error: "Daemon chat sessions not available" });
      } else {
        handleDaemonChat(this.chatPool, req, res, params.id).catch((err: Error) => {
          if (!res.headersSent) jsonResponse(res, 500, { error: err.message });
        });
      }
      return;
    }
    if (method === "DELETE" && params.id && path.startsWith("/sessions/")) {
      if (this.chatPool && deleteDaemonSession(this.chatPool, params.id)) {
        res.writeHead(204);
        res.end();
      } else {
        handleUnregisterSession(h, res, params);
      }
      return;
    }

    if (method === "GET" && path === "/metrics") { handleMetrics(h, res); return; }

    if (method === "POST" && path === "/push-tokens") { handleRegisterPushToken(h, req, res); return; }

    jsonResponse(res, 404, { error: "Not found" });
  }
}
