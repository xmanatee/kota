import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type {
  ControlRouteRegistration,
  RouteRegistration,
} from "#core/modules/module-types.js";
import { findRouteMatch } from "#core/modules/route-matcher.js";
import { normalizeScopeSelectorQueryUrl } from "#core/server/scope-selector.js";
import type { GuardrailsConfig } from "#core/tools/guardrails.js";
import type { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import type { DaemonChatConversationResolver } from "./daemon-chat-handlers.js";
import {
  type DaemonChatGuardrailsRefreshSummary,
  DaemonChatPool,
} from "./daemon-chat-pool.js";
import { DaemonControlRequestAuthorizer } from "./daemon-control-auth.js";
import type { DaemonControlServerOptions } from "./daemon-control-options.js";
import { DaemonControlRouteInvoker } from "./daemon-control-route-invoker.js";
import { buildBuiltinControlRoutes } from "./daemon-control-routes.js";
import type { DaemonControlHandle } from "./daemon-control-types.js";
import { jsonResponse } from "./daemon-control-utils.js";
import { type BufferedEvent, EventRingBuffer } from "./event-ring-buffer.js";

export type { ClientDashboardAvailability, ClientIdentity } from "./client-identity.js";
export { DASHBOARD_CAPABILITY_ID, WORKFLOW_TRIGGER_CAPABILITY_ID } from "./client-identity.js";
export type { DaemonControlServerOptions } from "./daemon-control-options.js";
export type {
  CapabilityScope, ComponentStatus, DaemonControlAddress, DaemonControlHandle,
  DaemonLiveStatus, DaemonSseEvent, DaemonSseEventType, DaemonSseStreamEvent,
  DaemonTimelineEvent, DeadLetterItem, DeadLetterItemStatus, DeadLetterItemType,
  DeadLetterQueueCounts, DeadLetterRedriveTarget, EventSchemaDetail, EventSchemaSummary,
  HealthStatus, InteractiveSession, WorkflowCostEntry, WorkflowDefinitionSummary,
  WorkflowDefinitionTriggerSummary, WorkflowDurationHistogramEntry, WorkflowLiveStatus,
  WorkflowMetricCounts, WorkflowRunCountEntry, WorkflowRunDetail, WorkflowRunStepSummary,
  WorkflowRunSummary,
} from "./daemon-control-types.js";
export type { ScopePolicyRouteResponse } from "./scope-policy.js";

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
  private readonly requestAuth: DaemonControlRequestAuthorizer;
  private readonly routeInvoker = new DaemonControlRouteInvoker();
  private quarantineReason: string | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly handle: DaemonControlHandle,
    token?: string,
    options?: DaemonControlServerOptions,
  ) {
    this.eventBuffer = new EventRingBuffer(options?.eventBufferSize ?? 500);
    this.requestAuth = new DaemonControlRequestAuthorizer(token);

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
      ...(options?.eventJournal !== undefined ? { eventJournal: options.eventJournal } : {}),
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

  /** Fail closed while an authority revocation tears down the current process. */
  quarantine(reason: string): void {
    this.quarantineReason = reason;
    this.chatPool?.closeAll();
  }

  refreshChatSessionGuardrails(config: GuardrailsConfig): DaemonChatGuardrailsRefreshSummary {
    return this.chatPool?.refreshGuardrails(config) ?? { refreshed: 0, unchanged: 0 };
  }

  listChatSessionIds(projectId: string): string[] {
    return this.chatPool?.list(projectId).map((session) => session.id) ?? [];
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

  private normalizeScopeSelectorQuery(
    req: IncomingMessage,
    res: ServerResponse,
  ): boolean {
    const normalized = normalizeScopeSelectorQueryUrl(
      new URL(req.url ?? "/", "http://127.0.0.1"),
    );
    if (!normalized.ok) {
      jsonResponse(res, normalized.status, normalized.body);
      return false;
    }
    if (normalized.changed) req.url = normalized.pathWithQuery;
    return true;
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (this.quarantineReason !== null) {
      jsonResponse(res, 503, {
        error: "Daemon authority is reloading",
        reason: "authority_revoked",
        message: this.quarantineReason,
      });
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const method = req.method ?? "GET";

    const controlMatch = findRouteMatch(this.controlRoutes, method, path);
    if (controlMatch) {
      if (!controlMatch.route.bypassAuth) {
        const auth = this.requestAuth.authorizeRoute(req, method, controlMatch.route);
        if (auth.kind === "unauthorized") {
          if (this.routeInvoker.invokeAuthFailureHandler(
            controlMatch.route,
            req,
            res,
            controlMatch.params,
          )) {
            return;
          }
          jsonResponse(res, 401, { error: "Unauthorized" });
          return;
        }
        if (auth.kind === "dashboard-guard-missing") {
          jsonResponse(res, 403, { error: "Dashboard request guard required" });
          return;
        }
      }
      if (!this.normalizeScopeSelectorQuery(req, res)) return;
      this.routeInvoker.invokeRouteHandler(controlMatch.route, req, res, controlMatch.params);
      return;
    }

    const moduleMatch = findRouteMatch(this.moduleRoutes, method, path);
    if (moduleMatch) {
      const dashboardEntry = this.requestAuth.isDashboardEntry(method, path);
      const auth = this.requestAuth.authorizeRoute(req, method, moduleMatch.route);
      if (!moduleMatch.route.bypassAuth) {
        if (auth.kind === "unauthorized") {
          if (this.routeInvoker.invokeAuthFailureHandler(
            moduleMatch.route,
            req,
            res,
            moduleMatch.params,
          )) {
            return;
          }
          jsonResponse(res, 401, { error: "Unauthorized" });
          return;
        }
        if (auth.kind === "dashboard-guard-missing") {
          jsonResponse(res, 403, { error: "Dashboard request guard required" });
          return;
        }
      }
      if (dashboardEntry && auth.kind !== "unauthorized") this.requestAuth.setDashboardAuthCookie(res);
      if (!this.normalizeScopeSelectorQuery(req, res)) return;
      this.routeInvoker.invokeRouteHandler(moduleMatch.route, req, res, moduleMatch.params);
      return;
    }

    jsonResponse(res, 404, { error: "Not found" });
  }
}
