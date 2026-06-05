import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type {
  ControlRouteRegistration,
  ModuleRouteHandler,
  RouteRegistration,
} from "#core/modules/module-types.js";
import { findRouteMatch } from "#core/modules/route-matcher.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { GuardrailsConfig } from "#core/tools/guardrails.js";
import type { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import type { DaemonChatConversationResolver } from "./daemon-chat-handlers.js";
import {
  type DaemonChatGuardrailsRefreshSummary,
  type DaemonChatMakeAgent,
  DaemonChatPool,
  type DaemonChatPoolOptions,
} from "./daemon-chat-pool.js";
import { buildBuiltinControlRoutes } from "./daemon-control-routes.js";
import type { DaemonControlHandle } from "./daemon-control-types.js";
import { jsonResponse } from "./daemon-control-utils.js";
import { type BufferedEvent, EventRingBuffer } from "./event-ring-buffer.js";

const DASHBOARD_AUTH_COOKIE = "kota_daemon_token";

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
  DaemonSseStreamEvent,
  DaemonTimelineEvent,
  EventSchemaDetail,
  EventSchemaSummary,
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

export type DaemonControlServerOptions = {
  /** Maximum number of events retained in the in-memory ring buffer. Default: 500. */
  eventBufferSize?: number;
  /**
   * When provided, enables POST /sessions, POST /sessions/:id/chat for daemon-owned sessions.
   * The factory receives the proxy transport, the session's autonomy mode, and
   * the conversation id the new AgentSession should resume from, plus the
   * configured project id the session must bind to.
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
  private readonly chatSweepMs: number;
  private readonly controlRoutes: readonly ControlRouteRegistration[];
  private readonly moduleRoutes: readonly RouteRegistration[];
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly handle: DaemonControlHandle,
    private readonly token?: string,
    options?: DaemonControlServerOptions,
  ) {
    this.eventBuffer = new EventRingBuffer(options?.eventBufferSize ?? 500);

    const makeAgent = options?.makeAgent ?? null;
    let chatBindings: DaemonChatBindingStore | null = null;
    let conversationResolver: DaemonChatConversationResolver | null = null;
    if (makeAgent) {
      if (!options?.chatBindings || !options.conversationResolver) {
        throw new Error(
          "DaemonControlServer: makeAgent requires chatBindings and conversationResolver options",
        );
      }
      chatBindings = options.chatBindings;
      conversationResolver = options.conversationResolver;
      this.chatPool = new DaemonChatPool(options?.chatPool);
    } else {
      this.chatPool = null;
    }
    const ttlMs = options?.chatPool?.ttlMs ?? (5 * 60 * 1000);
    this.chatSweepMs = Math.min(ttlMs, 60_000);

    const builtin = buildBuiltinControlRoutes({
      handle: this.handle,
      eventBuffer: this.eventBuffer,
      sseClients: this.sseClients,
      chatPool: this.chatPool,
      makeAgent,
      defaultAutonomyMode: options?.defaultAutonomyMode,
      chatBindings,
      conversationResolver,
    });

    const controlRoutes: ControlRouteRegistration[] = [...builtin];
    const seenKeys = new Set(controlRoutes.map((r) => `${r.method} ${r.path}`));
    for (const route of options?.controlRoutes ?? []) {
      const key = `${route.method} ${route.path}`;
      if (seenKeys.has(key)) {
        throw new Error(
          `DaemonControlServer: contributed control route "${key}" collides with ` +
            `an existing route (built-in or earlier module contribution)`,
        );
      }
      seenKeys.add(key);
      controlRoutes.push(route);
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
        if (seenKeys.has(key)) {
          throw new Error(
            `DaemonControlServer: module route "${key}" collides with an existing ` +
              `daemon-control route (built-in or contributed)`,
          );
        }
      }
    }
    this.controlRoutes = controlRoutes;
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
          const entry = this.eventBuffer.push(event);
          this.broadcast(entry);
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

  refreshChatSessionGuardrails(config: GuardrailsConfig): DaemonChatGuardrailsRefreshSummary {
    return this.chatPool?.refreshGuardrails(config) ?? { refreshed: 0, unchanged: 0 };
  }

  private isAuthorized(req: IncomingMessage): boolean {
    if (!this.token) return true;
    const header = req.headers.authorization ?? "";
    if (header === `Bearer ${this.token}`) return true;
    return this.cookieValue(req, DASHBOARD_AUTH_COOKIE) === this.token;
  }

  private cookieValue(req: IncomingMessage, name: string): string | undefined {
    const header = req.headers.cookie;
    if (!header) return undefined;
    for (const part of header.split(";")) {
      const [rawName, ...rawValue] = part.trim().split("=");
      if (rawName !== name) continue;
      return rawValue.join("=");
    }
    return undefined;
  }

  private isDashboardEntry(method: string, path: string): boolean {
    return method === "GET" && (path === "/" || path === "/index.html");
  }

  private setDashboardAuthCookie(res: ServerResponse): void {
    if (!this.token) return;
    res.setHeader(
      "Set-Cookie",
      `${DASHBOARD_AUTH_COOKIE}=${encodeURIComponent(this.token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
    );
  }

  private serializeEvent(entry: BufferedEvent): string {
    const { event } = entry;
    return `id: ${entry.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
  }

  private broadcast(entry: BufferedEvent): void {
    const chunk = this.serializeEvent(entry);
    for (const res of this.sseClients) {
      try {
        res.write(chunk);
      } catch {
        this.sseClients.delete(res);
      }
    }
  }

  private handleRouteError(res: ServerResponse, err: Error | string): void {
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) jsonResponse(res, 500, { error: message });
  }

  private invokeHandler(
    handler: ModuleRouteHandler,
    req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
  ): void {
    const onRejected = (err: Error | string) => {
      this.handleRouteError(res, err);
    };
    try {
      Promise.resolve(handler(req, res, params)).catch(onRejected);
    } catch (err) {
      this.handleRouteError(res, err instanceof Error ? err : String(err));
    }
  }

  private invokeRouteHandler(
    route: ControlRouteRegistration | RouteRegistration,
    req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
  ): void {
    this.invokeHandler(route.handler, req, res, params);
  }

  private invokeAuthFailureHandler(
    route: ControlRouteRegistration | RouteRegistration,
    req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
  ): boolean {
    if (!route.authFailureHandler) return false;
    this.invokeHandler(route.authFailureHandler, req, res, params);
    return true;
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const method = req.method ?? "GET";

    const controlMatch = findRouteMatch(this.controlRoutes, method, path);
    if (controlMatch) {
      if (!controlMatch.route.bypassAuth && !this.isAuthorized(req)) {
        if (this.invokeAuthFailureHandler(controlMatch.route, req, res, controlMatch.params)) {
          return;
        }
        jsonResponse(res, 401, { error: "Unauthorized" });
        return;
      }
      this.invokeRouteHandler(controlMatch.route, req, res, controlMatch.params);
      return;
    }

    const moduleMatch = findRouteMatch(this.moduleRoutes, method, path);
    if (moduleMatch) {
      const dashboardEntry = this.isDashboardEntry(method, path);
      if (!moduleMatch.route.bypassAuth && !this.isAuthorized(req)) {
        if (dashboardEntry) {
          this.setDashboardAuthCookie(res);
          this.invokeRouteHandler(moduleMatch.route, req, res, moduleMatch.params);
          return;
        }
        if (this.invokeAuthFailureHandler(moduleMatch.route, req, res, moduleMatch.params)) {
          return;
        }
        jsonResponse(res, 401, { error: "Unauthorized" });
        return;
      }
      if (dashboardEntry) this.setDashboardAuthCookie(res);
      this.invokeRouteHandler(moduleMatch.route, req, res, moduleMatch.params);
      return;
    }

    jsonResponse(res, 404, { error: "Not found" });
  }
}
