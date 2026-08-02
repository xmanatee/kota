import type { ControlRouteRegistration } from "#core/modules/module-types.js";
import type { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import {
  cancelDaemonSessionTurn,
  deleteDaemonSession,
  handleCreateDaemonSession,
  handleDaemonChat,
  handleDaemonChatEvents,
  handlePatchDaemonSession,
  handleResolveDaemonChatApproval,
} from "./daemon-chat-handlers.js";
import type { BuiltinControlRouteDeps } from "./daemon-control-routes.js";
import { handleRegisterSession, handleUnregisterSession } from "./daemon-control-sessions.js";
import type { InteractiveSession } from "./daemon-control-types.js";
import { jsonResponse, resolveProjectIdParam } from "./daemon-control-utils.js";
import type { ProjectId } from "./scope-registry.js";

function listInteractiveSessions(
  deps: BuiltinControlRouteDeps,
  projectId: ProjectId | undefined,
): InteractiveSession[] {
  const { handle, chatPool } = deps;
  const resolvedProjectId = projectId ?? handle.getProjectRegistryProjection().defaultProjectId;
  if (!chatPool) return handle.listSessions(resolvedProjectId);
  const daemonEntries = chatPool.list(resolvedProjectId);
  const daemonIds = new Set(daemonEntries.map((session) => session.id));
  const serveSessions = handle
    .listSessions(resolvedProjectId)
    .filter((session) => !daemonIds.has(session.id))
    .map((session) => ({ ...session, source: "serve" as const }));
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

function unavailableChatPool(res: Parameters<ControlRouteRegistration["handler"]>[1]): void {
  jsonResponse(res, 503, { error: "Daemon chat sessions not available" });
}

export function buildDaemonSessionControlRoutes(
  deps: BuiltinControlRouteDeps,
): ControlRouteRegistration[] {
  const {
    handle: h,
    chatPool,
    makeAgent,
    defaultAutonomyMode,
    chatBindings,
    conversationResolver,
  } = deps;
  return [
    {
      method: "GET",
      path: "/sessions",
      capabilityScope: "read",
      handler: (req, res) => {
        const scope = resolveProjectIdParam(h, new URL(req.url ?? "/", "http://127.0.0.1"));
        if (!scope.ok) {
          jsonResponse(res, scope.status, scope.error);
          return;
        }
        jsonResponse(res, 200, { sessions: listInteractiveSessions(deps, scope.projectId) });
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
        const scope = resolveProjectIdParam(h, new URL(req.url ?? "/", "http://127.0.0.1"));
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
          unavailableChatPool(res);
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
          () => {
            const state = h.getScopeHostingState(projectId);
            return state === "hosted"
              ? { ok: true }
              : { ok: false, reason: "scope_not_hosted", scopeId: projectId, state };
          },
        );
      },
    },
    {
      method: "POST",
      path: "/sessions/register",
      capabilityScope: "control",
      handler: (req, res) => handleRegisterSession(
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
          unavailableChatPool(res);
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
          unavailableChatPool(res);
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
          unavailableChatPool(res);
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
          unavailableChatPool(res);
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
      handler: (req, res, params) => handlePatchDaemonSession(
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
