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
import { getModuleEventRegistry } from "#core/events/module-event.js";
import type { ControlRouteRegistration } from "#core/modules/module-types.js";
import type {
  ModuleSetupCompleteInput,
  ModuleSetupFailureResult,
  ModuleSetupFormValue,
  ModuleSetupFormValues,
  ModuleSetupJsonValue,
  ModuleSetupMutationResult,
  ModuleSetupStartResult,
} from "#core/modules/setup-requirements.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import {
  cancelDaemonSessionTurn,
  type DaemonChatConversationResolver,
  deleteDaemonSession,
  handleCreateDaemonSession,
  handleDaemonChat,
  handleDaemonChatEvents,
  handlePatchDaemonSession,
  handleResolveDaemonChatApproval,
} from "./daemon-chat-handlers.js";
import type { DaemonChatMakeAgent, DaemonChatPool } from "./daemon-chat-pool.js";
import { handleRegisterSession, handleUnregisterSession } from "./daemon-control-sessions.js";
import type {
  DaemonControlHandle,
  DaemonLiveStatus,
  EventSchemaDetail,
  EventSchemaSummary,
  InteractiveSession,
} from "./daemon-control-types.js";
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
import { type ProjectId, scopeProjectionFromProjects } from "./scope-registry.js";

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

function listDaemonChatBindings(
  chatBindings: DaemonChatBindingStore,
  projectId: ProjectId | undefined,
) {
  return chatBindings
    .list()
    .filter((binding) => projectId === undefined || binding.projectId === projectId);
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

function listEventSchemaDetails(): EventSchemaDetail[] {
  const registry = getModuleEventRegistry();
  if (!registry) return [];
  return [...registry.all().values()]
    .map((registration): EventSchemaDetail => ({
      name: registration.name,
      module: registration.module,
      scope: registration.scope,
      currentVersion: registration.currentVersion,
      fields: registration.fields,
      filterablePaths: registration.filterablePaths,
      sensitivity: registration.sensitivity,
      compatibility: registration.compatibility,
      payloadSchema: registration.payloadSchema,
      examples: registration.examples,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function eventSchemaSummary(detail: EventSchemaDetail): EventSchemaSummary {
  return {
    name: detail.name,
    module: detail.module,
    scope: detail.scope,
    currentVersion: detail.currentVersion,
    fields: detail.fields,
    filterablePaths: detail.filterablePaths,
    sensitivity: detail.sensitivity,
    compatibility: detail.compatibility,
  };
}

type SetupJsonObject = { [key: string]: ModuleSetupJsonValue };

type ParsedSetupBody<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

function setupErrorStatus(result: ModuleSetupFailureResult): 400 | 404 | 500 {
  if (result.reason === "not_found") return 404;
  if (result.reason === "store_error") return 500;
  return 400;
}

function respondSetupMutation(
  res: ServerResponse,
  result: ModuleSetupMutationResult | ModuleSetupStartResult,
): void {
  if (result.ok) {
    jsonResponse(res, 200, result);
    return;
  }
  jsonResponse(res, setupErrorStatus(result), result);
}

function asSetupObject(
  value: ModuleSetupJsonValue,
): SetupJsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value;
}

function parseSetupJson(raw: Buffer): ParsedSetupBody<SetupJsonObject> {
  try {
    const text = raw.toString("utf8");
    const parsed = JSON.parse(text || "{}") as ModuleSetupJsonValue;
    const obj = asSetupObject(parsed);
    if (!obj) return { ok: false, message: "Body must be a JSON object" };
    return { ok: true, value: obj };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

function parseFormValues(
  raw: Buffer,
): ParsedSetupBody<ModuleSetupFormValues> {
  const parsed = parseSetupJson(raw);
  if (!parsed.ok) return parsed;
  const values = asSetupObject(parsed.value.values ?? null);
  if (!values) return { ok: false, message: "Body must include object `values`" };
  const out: ModuleSetupFormValues = {};
  for (const [key, value] of Object.entries(values)) {
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      return { ok: false, message: `Value for "${key}" must be string, number, or boolean` };
    }
    out[key] = value;
  }
  return { ok: true, value: out };
}

function parseSecretValues(raw: Buffer): ParsedSetupBody<Record<string, string>> {
  const parsed = parseSetupJson(raw);
  if (!parsed.ok) return parsed;
  const values = asSetupObject(parsed.value.secretValues ?? null);
  if (!values) return { ok: false, message: "Body must include object `secretValues`" };
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== "string" || value.length === 0) {
      return { ok: false, message: `Secret value for "${key}" must be a non-empty string` };
    }
    out[key] = value;
  }
  return { ok: true, value: out };
}

function readOptionalFormValues(
  value: ModuleSetupJsonValue | undefined,
): ModuleSetupFormValues | undefined | string {
  if (value === undefined) return undefined;
  const obj = asSetupObject(value);
  if (!obj) return "`configValues` must be an object";
  const out: ModuleSetupFormValues = {};
  for (const [key, entry] of Object.entries(obj)) {
    if (
      typeof entry !== "string" &&
      typeof entry !== "number" &&
      typeof entry !== "boolean"
    ) {
      return `Config value for "${key}" must be string, number, or boolean`;
    }
    out[key] = entry as ModuleSetupFormValue;
  }
  return out;
}

function readOptionalSecretValues(
  value: ModuleSetupJsonValue | undefined,
): Record<string, string> | undefined | string {
  if (value === undefined) return undefined;
  const obj = asSetupObject(value);
  if (!obj) return "`secretValues` must be an object";
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(obj)) {
    if (typeof entry !== "string" || entry.length === 0) {
      return `Secret value for "${key}" must be a non-empty string`;
    }
    out[key] = entry;
  }
  return out;
}

function parseCompleteInput(
  raw: Buffer,
): ParsedSetupBody<ModuleSetupCompleteInput> {
  const parsed = parseSetupJson(raw);
  if (!parsed.ok) return parsed;
  const configValues = readOptionalFormValues(parsed.value.configValues);
  if (typeof configValues === "string") return { ok: false, message: configValues };
  const secretValues = readOptionalSecretValues(parsed.value.secretValues);
  if (typeof secretValues === "string") return { ok: false, message: secretValues };
  return {
    ok: true,
    value: {
      ...(configValues !== undefined && { configValues }),
      ...(secretValues !== undefined && { secretValues }),
    },
  };
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
          jsonResponse(res, scope.status, scope.error);
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
      path: "/scopes",
      capabilityScope: "read",
      handler: (_req, res) => {
        const projects = h.getProjectRegistryProjection();
        jsonResponse(
          res,
          200,
          scopeProjectionFromProjects(projects.defaultProjectId, projects.projects),
        );
      },
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
      path: "/event-schemas",
      capabilityScope: "read",
      handler: (_req, res) =>
        jsonResponse(res, 200, {
          events: listEventSchemaDetails().map(eventSchemaSummary),
        }),
    },
    {
      method: "GET",
      path: "/event-schemas/:name",
      capabilityScope: "read",
      handler: (_req, res, params) => {
        const detail = listEventSchemaDetails().find(
          (candidate) => candidate.name === params.name,
        );
        if (!detail) {
          jsonResponse(res, 404, {
            error: "Unknown event schema",
            reason: "unknown_event_schema",
            event: params.name,
          });
          return;
        }
        jsonResponse(res, 200, detail);
      },
    },
    {
      method: "GET",
      path: "/setup/requirements",
      capabilityScope: "read",
      handler: (_req, res) =>
        h.listModuleSetupStatuses().then((response) => jsonResponse(res, 200, response)),
    },
    {
      method: "POST",
      path: "/setup/requirements/:moduleName/:requirementId/form",
      capabilityScope: "control",
      handler: async (req, res, params) => {
        const body = parseFormValues(await readBody(req));
        if (!body.ok) {
          jsonResponse(res, 400, { ok: false, reason: "invalid_request", message: body.message });
          return;
        }
        respondSetupMutation(
          res,
          await h.submitModuleSetupForm(params.moduleName, params.requirementId, body.value),
        );
      },
    },
    {
      method: "POST",
      path: "/setup/requirements/:moduleName/:requirementId/secret",
      capabilityScope: "control",
      handler: async (req, res, params) => {
        const body = parseSecretValues(await readBody(req));
        if (!body.ok) {
          jsonResponse(res, 400, { ok: false, reason: "invalid_request", message: body.message });
          return;
        }
        respondSetupMutation(
          res,
          await h.storeModuleSetupSecret(params.moduleName, params.requirementId, body.value),
        );
      },
    },
    {
      method: "POST",
      path: "/setup/requirements/:moduleName/:requirementId/start",
      capabilityScope: "control",
      handler: async (_req, res, params) =>
        respondSetupMutation(
          res,
          await h.startModuleSetup(params.moduleName, params.requirementId),
        ),
    },
    {
      method: "POST",
      path: "/setup/actions/:actionId/complete",
      capabilityScope: "control",
      handler: async (req, res, params) => {
        const body = parseCompleteInput(await readBody(req));
        if (!body.ok) {
          jsonResponse(res, 400, { ok: false, reason: "invalid_request", message: body.message });
          return;
        }
        respondSetupMutation(res, await h.completeModuleSetup(params.actionId, body.value));
      },
    },
    {
      method: "POST",
      path: "/setup/requirements/:moduleName/:requirementId/refresh",
      capabilityScope: "control",
      handler: async (_req, res, params) =>
        respondSetupMutation(
          res,
          await h.refreshModuleSetup(params.moduleName, params.requirementId),
        ),
    },
    {
      method: "DELETE",
      path: "/setup/requirements/:moduleName/:requirementId",
      capabilityScope: "control",
      handler: async (_req, res, params) =>
        respondSetupMutation(
          res,
          await h.revokeModuleSetup(params.moduleName, params.requirementId),
        ),
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
          jsonResponse(res, scope.status, scope.error);
          return;
        }
        jsonResponse(res, 200, { sessions: listInteractiveSessions(h, chatPool, scope.projectId) });
      },
    },
    {
      method: "GET",
      path: "/sessions/bindings",
      capabilityScope: "read",
      handler: (req, res) => {
        if (!chatBindings) {
          jsonResponse(res, 503, { error: "Daemon chat session bindings not available" });
          return;
        }
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const scope = resolveProjectIdParam(h, url);
        if (!scope.ok) {
          jsonResponse(res, scope.status, scope.error);
          return;
        }
        jsonResponse(res, 200, { bindings: listDaemonChatBindings(chatBindings, scope.projectId) });
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
          jsonResponse(res, scope.status, scope.error);
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
      handler: (req, res) =>
        handleRegisterSession(
          h,
          req,
          res,
          new URL(req.url ?? "/", "http://127.0.0.1"),
        ),
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
      path: "/sessions/:id/approvals/:approvalId",
      capabilityScope: "control",
      handler: (req, res, params) => {
        if (!chatPool) {
          jsonResponse(res, 503, { error: "Daemon chat sessions not available" });
          return;
        }
        return handleResolveDaemonChatApproval(
          chatPool,
          req,
          res,
          params.id,
          params.approvalId,
        );
      },
    },
    {
      method: "GET",
      path: "/sessions/:id/events",
      capabilityScope: "read",
      handler: (req, res, params) => {
        if (!chatPool) {
          jsonResponse(res, 503, { error: "Daemon chat sessions not available" });
          return;
        }
        handleDaemonChatEvents(chatPool, req, res, params.id);
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
