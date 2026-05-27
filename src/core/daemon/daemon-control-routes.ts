/**
 * Built-in daemon-control routes, expressed in the same
 * `ControlRouteRegistration` shape that modules use through
 * `KotaModule.controlRoutes`. The server merges these with contributed entries
 * into one table; the dispatcher matches once and runs the matched route's
 * handler. No parallel scope/handler/bypass tables.
 *
 * Each handler closure binds the runtime state it needs (the daemon handle,
 * event ring buffer, SSE client set, daemon chat pool, session bindings) at
 * registration time, so the dispatcher itself stays free of route-specific
 * dependencies.
 */

import type { ServerResponse } from "node:http";
import type { ControlRouteRegistration } from "#core/modules/module-types.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import {
  cancelDaemonSessionTurn,
  type DaemonChatConversationResolver,
  deleteDaemonSession,
  handleCreateDaemonSession,
  handleDaemonChat,
  handlePatchDaemonSession,
} from "./daemon-chat-handlers.js";
import type { DaemonChatMakeAgent, DaemonChatPool } from "./daemon-chat-pool.js";
import { handleRegisterSession, handleUnregisterSession } from "./daemon-control-sessions.js";
import type { DaemonControlHandle, DaemonLiveStatus, InteractiveSession } from "./daemon-control-types.js";
import { jsonResponse, parseActiveProjectPatchBody, readBody, resolveProjectIdParam } from "./daemon-control-utils.js";
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
import type { EventRingBuffer } from "./event-ring-buffer.js";
import type { ProjectId } from "./project-registry.js";

/** Inputs the built-in route closures bind at registration time. */
export type BuiltinControlRouteDeps = {
  handle: DaemonControlHandle;
  eventBuffer: EventRingBuffer;
  sseClients: Set<ServerResponse>;
  chatPool: DaemonChatPool | null;
  makeAgent: DaemonChatMakeAgent | null;
  defaultAutonomyMode: AutonomyMode | undefined;
  chatBindings: DaemonChatBindingStore | null;
  conversationResolver: DaemonChatConversationResolver | null;
};

function listInteractiveSessions(
  handle: DaemonControlHandle,
  chatPool: DaemonChatPool | null,
  projectId: ProjectId | undefined,
): InteractiveSession[] {
  const resolvedProjectId = projectId ?? handle.getProjectRegistryProjection().defaultProjectId;
  if (!chatPool) return handle.listSessions(resolvedProjectId);
  const daemonEntries = chatPool.list(resolvedProjectId);
  const daemonIds = new Set(daemonEntries.map((s) => s.id));
  const serveSessions = handle
    .listSessions(resolvedProjectId)
    .filter((s) => !daemonIds.has(s.id))
    .map((s) => ({ ...s, source: "serve" as const }));
  return [...serveSessions, ...daemonEntries];
}

function eventTypeMatchesGlob(eventType: string, glob: string): boolean {
  const segments = glob.split("*");
  const prefix = segments[0] ?? "";
  if (prefix !== "" && !eventType.startsWith(prefix)) return false;

  let offset = prefix.length;
  const suffix = segments[segments.length - 1] ?? "";
  for (let index = 1; index < segments.length - 1; index++) {
    const segment = segments[index];
    if (segment === "") continue;
    const foundAt = eventType.indexOf(segment, offset);
    if (foundAt === -1) return false;
    offset = foundAt + segment.length;
  }

  if (suffix === "") return true;
  const suffixStart = eventType.length - suffix.length;
  return suffixStart >= offset && eventType.endsWith(suffix);
}

export function buildBuiltinControlRoutes(deps: BuiltinControlRouteDeps): ControlRouteRegistration[] {
  const {
    handle: h,
    eventBuffer,
    sseClients,
    chatPool,
    makeAgent,
    defaultAutonomyMode,
    chatBindings,
    conversationResolver,
  } = deps;

  return [
    {
      method: "GET",
      path: "/health",
      capabilityScope: "read",
      bypassAuth: true,
      handler: (_req, res) => {
        const health = h.getHealthStatus();
        const state = h.getDaemonLiveState();
        const uptimeMs = Date.now() - new Date(state.startedAt).getTime();
        const degraded = health.scheduler === "error" || health.modules === "error";
        jsonResponse(res, degraded ? 503 : 200, {
          status: degraded ? "degraded" : "ok",
          version: "0.1.0",
          uptimeMs,
          components: health,
        });
      },
    },
    {
      method: "GET",
      path: "/status",
      capabilityScope: "read",
      handler: (req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const scope = resolveProjectIdParam(h, url);
        if (!scope.ok) {
          jsonResponse(res, 404, scope.error);
          return;
        }
        const daemonState = h.getDaemonLiveState();
        const workflowStatus = h.getWorkflowLiveStatus(scope.projectId);
        const sessions = listInteractiveSessions(h, chatPool, scope.projectId);
        const channels = h.listChannelStatuses();
        const body: DaemonLiveStatus = {
          ...daemonState,
          workflow: workflowStatus,
          sessions,
          channels,
        };
        jsonResponse(res, 200, body);
      },
    },
    {
      method: "GET",
      path: "/projects",
      capabilityScope: "read",
      handler: (_req, res) =>
        jsonResponse(res, 200, {
          ...h.getProjectRegistryProjection(),
          activeProjectId: h.getActiveProjectId(),
        }),
    },
    {
      method: "GET",
      path: "/projects/active",
      capabilityScope: "read",
      handler: (_req, res) =>
        jsonResponse(res, 200, { activeProjectId: h.getActiveProjectId() }),
    },
    {
      method: "PATCH",
      path: "/projects/active",
      capabilityScope: "control",
      handler: async (req, res) => {
        const raw = await readBody(req);
        const next = parseActiveProjectPatchBody(raw.toString("utf8"));
        if (!next.ok) {
          jsonResponse(res, 400, next.error);
          return;
        }
        const result = h.setActiveProjectId(next.projectId);
        if (!result.ok) {
          jsonResponse(res, 404, {
            error: "Unknown project",
            reason: "unknown_project",
            projectId: result.projectId,
          });
          return;
        }
        jsonResponse(res, 200, { activeProjectId: result.activeProjectId });
      },
    },
    {
      method: "GET",
      path: "/channels",
      capabilityScope: "read",
      handler: (_req, res) => jsonResponse(res, 200, { channels: h.listChannelStatuses() }),
    },
    {
      method: "GET",
      path: "/capabilities",
      capabilityScope: "read",
      handler: (_req, res) => h.probeCapabilityReadiness().then((response) => jsonResponse(res, 200, response)),
    },
    {
      method: "GET",
      path: "/identity",
      capabilityScope: "read",
      handler: (_req, res) => h.getClientIdentity().then((identity) => jsonResponse(res, 200, identity)),
    },
    {
      method: "GET",
      path: "/events",
      capabilityScope: "read",
      handler: (req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(":\n\n");
        const sinceParam = url.searchParams.get("since");
        const afterParam = url.searchParams.get("after") ?? req.headers["last-event-id"];
        if (sinceParam) {
          const sinceMs = new Date(sinceParam).getTime();
          if (!Number.isNaN(sinceMs)) {
            const afterId = typeof afterParam === "string" ? afterParam : undefined;
            for (const entry of eventBuffer.query(sinceMs, undefined, afterId)) {
              res.write(`id: ${entry.id}\nevent: ${entry.event.type}\ndata: ${JSON.stringify(entry.event.payload)}\n\n`);
            }
          }
        } else {
          const afterId = typeof afterParam === "string" ? afterParam : undefined;
          if (afterId) {
            for (const entry of eventBuffer.query(undefined, undefined, afterId)) {
              res.write(`id: ${entry.id}\nevent: ${entry.event.type}\ndata: ${JSON.stringify(entry.event.payload)}\n\n`);
            }
          }
        }
        sseClients.add(res);
        req.on("close", () => { sseClients.delete(res); });
      },
    },
    {
      method: "GET",
      path: "/api/events",
      capabilityScope: "read",
      handler: (req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const sinceParam = url.searchParams.get("since");
        const afterParam = url.searchParams.get("after");
        const limitParam = url.searchParams.get("limit");
        const typeParam = url.searchParams.get("type");
        const sinceMs = sinceParam ? new Date(sinceParam).getTime() : undefined;
        const limit = limitParam ? parseInt(limitParam, 10) : undefined;
        let entries = eventBuffer.query(
          sinceMs != null && !Number.isNaN(sinceMs) ? sinceMs : undefined,
          limit == null || typeParam != null ? undefined : limit,
          afterParam ?? undefined,
        );
        if (typeParam) {
          const isGlob = typeParam.includes("*");
          if (isGlob) {
            entries = entries.filter(({ event }) => eventTypeMatchesGlob(event.type, typeParam));
          } else {
            entries = entries.filter(({ event }) => event.type.startsWith(typeParam));
          }
          if (limit != null && entries.length > limit) {
            entries = entries.slice(entries.length - limit);
          }
        }
        jsonResponse(res, 200, {
          events: entries.map(({ id, event, timestamp }) => ({
            id,
            type: event.type,
            payload: event.payload,
            timestamp: new Date(timestamp).toISOString(),
          })),
        });
      },
    },
    {
      method: "GET",
      path: "/workflow/status",
      capabilityScope: "read",
      handler: (req, res) => handleGetWorkflowStatus(h, res, new URL(req.url ?? "/", "http://127.0.0.1")),
    },
    {
      method: "GET",
      path: "/workflow/definitions",
      capabilityScope: "read",
      handler: (req, res) => handleGetWorkflowDefinitions(h, res, new URL(req.url ?? "/", "http://127.0.0.1")),
    },
    {
      method: "POST",
      path: "/workflow/definitions/:name/disable",
      capabilityScope: "control",
      handler: (req, res, params) => handleDisableWorkflow(h, res, params, new URL(req.url ?? "/", "http://127.0.0.1")),
    },
    {
      method: "POST",
      path: "/workflow/definitions/:name/enable",
      capabilityScope: "control",
      handler: (req, res, params) => handleEnableWorkflow(h, res, params, new URL(req.url ?? "/", "http://127.0.0.1")),
    },
    {
      method: "GET",
      path: "/workflow/runs",
      capabilityScope: "read",
      handler: (req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        handleListWorkflowRuns(h, res, url);
      },
    },
    {
      method: "GET",
      path: "/workflow/runs/:id",
      capabilityScope: "read",
      handler: (req, res, params) => handleGetWorkflowRun(h, res, params, new URL(req.url ?? "/", "http://127.0.0.1")),
    },
    {
      method: "DELETE",
      path: "/workflow/runs/:id",
      capabilityScope: "control",
      handler: (req, res, params) => handleCancelWorkflowRun(h, res, params, new URL(req.url ?? "/", "http://127.0.0.1")),
    },
    {
      method: "POST",
      path: "/workflow/runs/:id/abort",
      capabilityScope: "control",
      handler: (req, res, params) => handleAbortWorkflowRun(h, res, params, new URL(req.url ?? "/", "http://127.0.0.1")),
    },
    {
      method: "POST",
      path: "/workflow/pause",
      capabilityScope: "control",
      handler: (req, res) => handlePauseWorkflow(h, res, new URL(req.url ?? "/", "http://127.0.0.1")),
    },
    {
      method: "POST",
      path: "/workflow/resume",
      capabilityScope: "control",
      handler: (req, res) => handleResumeWorkflow(h, res, new URL(req.url ?? "/", "http://127.0.0.1")),
    },
    {
      method: "POST",
      path: "/workflow/abort",
      capabilityScope: "control",
      handler: (req, res) => handleAbortWorkflow(h, res, new URL(req.url ?? "/", "http://127.0.0.1")),
    },
    {
      method: "POST",
      path: "/workflow/reload",
      capabilityScope: "control",
      handler: (req, res) => handleReloadWorkflow(h, res, new URL(req.url ?? "/", "http://127.0.0.1")),
    },
    {
      method: "POST",
      path: "/reload",
      capabilityScope: "control",
      handler: (_req, res) => handleReloadConfig(h, res),
    },
    {
      method: "POST",
      path: "/workflow/trigger",
      capabilityScope: "control",
      handler: (req, res) => handleTriggerWorkflow(h, req, res, new URL(req.url ?? "/", "http://127.0.0.1")),
    },
    {
      method: "GET",
      path: "/sessions",
      capabilityScope: "read",
      handler: (req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const scope = resolveProjectIdParam(h, url);
        if (!scope.ok) {
          jsonResponse(res, 404, scope.error);
          return;
        }
        jsonResponse(res, 200, { sessions: listInteractiveSessions(h, chatPool, scope.projectId) });
      },
    },
    {
      method: "POST",
      path: "/sessions",
      capabilityScope: "control",
      handler: (req, res) => {
        if (!chatPool || !makeAgent || !chatBindings || !conversationResolver) {
          jsonResponse(res, 503, { error: "Daemon chat sessions not available" });
          return;
        }
        const scope = resolveProjectIdParam(h, new URL(req.url ?? "/", "http://127.0.0.1"));
        if (!scope.ok) {
          jsonResponse(res, 404, scope.error);
          return;
        }
        const projectId = scope.projectId ?? h.getProjectRegistryProjection().defaultProjectId;
        return handleCreateDaemonSession(
          chatPool,
          chatBindings,
          req,
          res,
          makeAgent,
          defaultAutonomyMode,
          projectId,
          conversationResolver,
        );
      },
    },
    {
      method: "POST",
      path: "/sessions/register",
      capabilityScope: "control",
      handler: (req, res) => handleRegisterSession(h, req, res),
    },
    {
      method: "POST",
      path: "/sessions/:id/chat",
      capabilityScope: "control",
      handler: (req, res, params) => {
        if (!chatPool) {
          jsonResponse(res, 503, { error: "Daemon chat sessions not available" });
          return;
        }
        return handleDaemonChat(chatPool, req, res, params.id);
      },
    },
    {
      method: "POST",
      path: "/sessions/:id/cancel",
      capabilityScope: "control",
      handler: (_req, res, params) => {
        if (!chatPool) {
          jsonResponse(res, 503, { error: "Daemon chat sessions not available" });
          return;
        }
        if (!cancelDaemonSessionTurn(chatPool, params.id)) {
          jsonResponse(res, 404, { error: "Session not found" });
          return;
        }
        res.writeHead(204);
        res.end();
      },
    },
    {
      method: "PATCH",
      path: "/sessions/:id",
      capabilityScope: "control",
      handler: (req, res, params) =>
        handlePatchDaemonSession(
          chatPool,
          (id, mode) => h.setSessionAutonomyMode(id, mode),
          req,
          res,
          params.id,
        ),
    },
    {
      method: "DELETE",
      path: "/sessions/:id",
      capabilityScope: "control",
      handler: (_req, res, params) => {
        if (chatPool && deleteDaemonSession(chatPool, params.id, chatBindings ?? undefined)) {
          res.writeHead(204);
          res.end();
          return;
        }
        handleUnregisterSession(h, res, params);
      },
    },
  ];
}
