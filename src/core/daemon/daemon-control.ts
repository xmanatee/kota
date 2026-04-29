import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ControlRouteRegistration, RouteRegistration } from "#core/modules/module-types.js";
import { findKeyedRouteMatch, findRouteMatch } from "#core/modules/route-matcher.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import {
  type DaemonChatConversationResolver,
  type DaemonChatMakeAgent,
  DaemonChatPool,
  type DaemonChatPoolOptions,
  deleteDaemonSession,
  handleCreateDaemonSession,
  handleDaemonChat,
  handlePatchDaemonSession,
} from "./daemon-control-chat.js";
import { handleListSessions, handleRegisterSession, handleUnregisterSession } from "./daemon-control-sessions.js";
import type { CapabilityScope, DaemonControlHandle, DaemonLiveStatus, DaemonSseEvent } from "./daemon-control-types.js";
import { jsonResponse } from "./daemon-control-utils.js";
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
  ClientDashboardAvailability,
  ClientIdentity,
} from "./client-identity.js";
export {
  DASHBOARD_CAPABILITY_ID,
  WORKFLOW_TRIGGER_CAPABILITY_ID,
} from "./client-identity.js";
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

// Built-in daemon-control routes and their required capability scope.
// Modules contribute additional exact-match routes through
// KotaModule.controlRoutes; collisions with this table or with another
// module's contribution throw at server construction time.
const BUILTIN_ROUTE_SCOPES: Record<string, CapabilityScope> = {
  "GET /status": "read",
  "GET /channels": "read",
  "GET /capabilities": "read",
  "GET /identity": "read",
  "GET /workflow/status": "read",
  "GET /events": "read",
  "GET /api/events": "read",
  "POST /workflow/trigger": "control",
  "POST /workflow/pause": "control",
  "POST /workflow/resume": "control",
  "POST /workflow/abort": "control",
  "POST /workflow/reload": "control",
  "POST /reload": "control",
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
};


export type DaemonControlServerOptions = {
  /** Maximum number of events retained in the in-memory ring buffer. Default: 500. */
  eventBufferSize?: number;
  /**
   * When provided, enables POST /sessions, POST /sessions/:id/chat for daemon-owned sessions.
   * The factory receives the proxy transport, the session's autonomy mode, and
   * the conversation id the new AgentSession should resume from.
   */
  makeAgent?: DaemonChatMakeAgent;
  /** Autonomy mode used when POST /sessions does not specify one. */
  defaultAutonomyMode?: AutonomyMode;
  /** Options forwarded to the daemon chat session pool. */
  chatPool?: DaemonChatPoolOptions;
  /**
   * Persisted session_id → conversationId binding. Required whenever
   * {@link DaemonControlServerOptions.makeAgent} is supplied so daemon chat
   * sessions survive a restart with a client-facing wake path.
   */
  chatBindings?: DaemonChatBindingStore;
  /**
   * Resolves / creates conversation ids for new and woken chat sessions.
   * Required whenever {@link DaemonControlServerOptions.makeAgent} is supplied.
   */
  conversationResolver?: DaemonChatConversationResolver;
  /**
   * Module-contributed daemon-control routes. Each contribution carries its
   * own capability scope; the router applies the same bearer-token and
   * scope check to contributed routes as to built-in ones. Paths colliding
   * with a built-in route or with another contribution throw at startup.
   */
  controlRoutes?: readonly ControlRouteRegistration[];
  /**
   * Module-contributed HTTP routes (the same `KotaModule.routes` list that
   * `kota serve` consumes). The daemon's control server registers them as a
   * fallthrough after built-in routes and contributed control routes do not
   * match, so a running daemon serves the same `/api/*` surface those modules
   * publish to `kota serve`. Bearer-token auth applies unless the route opts
   * out via `bypassAuth`. Path collisions with a built-in or contributed
   * control route throw at startup.
   */
  routes?: readonly RouteRegistration[];
};

export class DaemonControlServer {
  private server: Server | null = null;
  private port: number | null = null;
  private sseClients = new Set<ServerResponse>();
  private unsubscribeEvents: (() => void) | null = null;
  private readonly eventBuffer: EventRingBuffer;
  private readonly chatPool: DaemonChatPool | null;
  private readonly makeAgent: DaemonChatMakeAgent | null;
  private readonly chatBindings: DaemonChatBindingStore | null;
  private readonly conversationResolver: DaemonChatConversationResolver | null;
  private readonly defaultAutonomyMode: AutonomyMode | undefined;
  private readonly chatSweepMs: number;
  private readonly routeScopes: Record<string, CapabilityScope>;
  private readonly contributedHandlers: Map<string, ControlRouteRegistration["handler"]>;
  private readonly bypassAuthRoutes: Set<string>;
  private readonly moduleRoutes: readonly RouteRegistration[];
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly handle: DaemonControlHandle,
    private readonly token?: string,
    options?: DaemonControlServerOptions,
  ) {
    this.eventBuffer = new EventRingBuffer(options?.eventBufferSize ?? 500);
    this.makeAgent = options?.makeAgent ?? null;
    this.defaultAutonomyMode = options?.defaultAutonomyMode;
    if (this.makeAgent) {
      if (!options?.chatBindings || !options.conversationResolver) {
        throw new Error(
          "DaemonControlServer: makeAgent requires chatBindings and conversationResolver options",
        );
      }
      this.chatBindings = options.chatBindings;
      this.conversationResolver = options.conversationResolver;
      this.chatPool = new DaemonChatPool(options?.chatPool);
    } else {
      this.chatBindings = null;
      this.conversationResolver = null;
      this.chatPool = null;
    }
    const ttlMs = options?.chatPool?.ttlMs ?? (5 * 60 * 1000);
    this.chatSweepMs = Math.min(ttlMs, 60_000);

    const routeScopes: Record<string, CapabilityScope> = { ...BUILTIN_ROUTE_SCOPES };
    const contributedHandlers = new Map<string, ControlRouteRegistration["handler"]>();
    const bypassAuthRoutes = new Set<string>();
    for (const route of options?.controlRoutes ?? []) {
      const key = `${route.method} ${route.path}`;
      if (key in routeScopes) {
        throw new Error(
          `DaemonControlServer: contributed control route "${key}" collides with ` +
            `an existing route (built-in or earlier module contribution)`,
        );
      }
      routeScopes[key] = route.capabilityScope;
      contributedHandlers.set(key, route.handler);
      if (route.bypassAuth) bypassAuthRoutes.add(key);
    }
    const moduleRoutes = options?.routes ?? [];
    for (const route of moduleRoutes) {
      // Only flag a collision when a module route's literal (non-`:name`,
      // non-`*name`) path matches an already-registered control route. Module
      // routes with capture segments may intentionally overlap with sibling
      // literal paths registered by other modules; the matcher prefers exact
      // matches over capture patterns at request time.
      if (!route.path.includes(":") && !route.path.includes("*")) {
        const key = `${route.method} ${route.path}`;
        if (key in routeScopes) {
          throw new Error(
            `DaemonControlServer: module route "${key}" collides with an existing ` +
              `daemon-control route (built-in or contributed)`,
          );
        }
      }
    }
    this.routeScopes = routeScopes;
    this.contributedHandlers = contributedHandlers;
    this.bypassAuthRoutes = bypassAuthRoutes;
    this.moduleRoutes = moduleRoutes;
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

  private findModuleRoute(
    method: string,
    path: string,
  ): { route: RouteRegistration; params: Record<string, string> } | null {
    return findRouteMatch(this.moduleRoutes, method, path);
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

    const match = findKeyedRouteMatch(Object.keys(this.routeScopes), method, path);
    if (!match) {
      const moduleMatch = this.findModuleRoute(method, path);
      if (moduleMatch) {
        if (!moduleMatch.route.bypassAuth && !this.isAuthorized(req)) {
          jsonResponse(res, 401, { error: "Unauthorized" });
          return;
        }
        Promise.resolve(moduleMatch.route.handler(req, res, moduleMatch.params)).catch((err: Error) => {
          if (!res.headersSent) jsonResponse(res, 500, { error: err.message });
        });
        return;
      }
      jsonResponse(res, 404, { error: "Not found" });
      return;
    }

    if (!this.bypassAuthRoutes.has(match.key) && !this.isAuthorized(req)) {
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
      const channels = h.listChannelStatuses();
      const body: DaemonLiveStatus = {
        ...daemonState,
        workflow: workflowStatus,
        sessions,
        channels,
      };
      jsonResponse(res, 200, body);
      return;
    }

    if (method === "GET" && path === "/channels") {
      jsonResponse(res, 200, { channels: h.listChannelStatuses() });
      return;
    }

    if (method === "GET" && path === "/capabilities") {
      h.probeCapabilityReadiness()
        .then((response) => jsonResponse(res, 200, response))
        .catch((err: Error) => {
          if (!res.headersSent) jsonResponse(res, 500, { error: err.message });
        });
      return;
    }

    if (method === "GET" && path === "/identity") {
      h.getClientIdentity()
        .then((identity) => jsonResponse(res, 200, identity))
        .catch((err: Error) => {
          if (!res.headersSent) jsonResponse(res, 500, { error: err.message });
        });
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
      if (!this.chatPool || !this.makeAgent || !this.chatBindings || !this.conversationResolver) {
        jsonResponse(res, 503, { error: "Daemon chat sessions not available" });
      } else {
        handleCreateDaemonSession(
          this.chatPool,
          this.chatBindings,
          req,
          res,
          this.makeAgent,
          this.defaultAutonomyMode,
          this.conversationResolver,
        ).catch((err: Error) => {
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
      if (this.chatPool && deleteDaemonSession(this.chatPool, params.id, this.chatBindings ?? undefined)) {
        res.writeHead(204);
        res.end();
      } else {
        handleUnregisterSession(h, res, params);
      }
      return;
    }

    const contributed = this.contributedHandlers.get(match.key);
    if (contributed) {
      Promise.resolve(contributed(req, res, params)).catch((err: Error) => {
        if (!res.headersSent) jsonResponse(res, 500, { error: err.message });
      });
      return;
    }

    jsonResponse(res, 404, { error: "Not found" });
  }
}
