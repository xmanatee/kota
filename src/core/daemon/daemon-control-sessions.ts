import type { IncomingMessage, ServerResponse } from "node:http";
import { isAutonomyMode } from "#core/tools/autonomy-mode.js";
import type { BuiltinControlRouteDeps } from "./daemon-control-routes.js";
import type { DaemonControlHandle, InteractiveSession } from "./daemon-control-types.js";
import { jsonResponse, readBody, resolveScopeIdParam } from "./daemon-control-utils.js";
import type { ScopeId } from "./scope-registry.js";

export function handleListSessions(
  handle: DaemonControlHandle,
  res: ServerResponse,
  url?: URL,
): void {
  const scope = url ? resolveScopeIdParam(handle, url) : { ok: true as const, scopeId: undefined };
  if (!scope.ok) {
    jsonResponse(res, scope.status, scope.error);
    return;
  }
  jsonResponse(res, 200, { sessions: handle.listSessions(scope.scopeId) });
}

export function handleRegisterSession(
  handle: DaemonControlHandle,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): void {
  const scope = resolveScopeIdParam(handle, url);
  if (!scope.ok) {
    jsonResponse(res, scope.status, scope.error);
    return;
  }
  readBody(req)
    .then((buf) => {
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(buf.toString()) as Record<string, unknown>;
      } catch {
        jsonResponse(res, 400, { error: "Invalid JSON body" });
        return;
      }
      const id = body.id;
      const createdAt = body.createdAt;
      const autonomyMode = body.autonomyMode;
      if (!id || typeof id !== "string" || !createdAt || typeof createdAt !== "string") {
        jsonResponse(res, 400, { error: "id and createdAt are required strings" });
        return;
      }
      if (!isAutonomyMode(autonomyMode)) {
        jsonResponse(res, 400, { error: "autonomyMode is required (passive, supervised, autonomous)" });
        return;
      }
      const result = handle.registerSession(id, createdAt, autonomyMode, scope.scopeId);
      if (!result.ok) {
        jsonResponse(res, 409, {
          error: `Scope ${result.scopeId} is ${result.state} and cannot accept sessions`,
          reason: result.reason,
          scopeId: result.scopeId,
          state: result.state,
        });
        return;
      }
      jsonResponse(res, 200, { ok: true });
    })
    .catch(() => jsonResponse(res, 500, { error: "Internal error" }));
}

export function handleUnregisterSession(
  handle: DaemonControlHandle,
  res: ServerResponse,
  params: Record<string, string>,
): void {
  handle.unregisterSession(params.id);
  res.writeHead(204);
  res.end();
}

export function listInteractiveSessions(
  deps: BuiltinControlRouteDeps,
  scopeId: ScopeId | undefined,
): InteractiveSession[] {
  const { handle, chatPool } = deps;
  const resolvedScopeId = scopeId ?? handle.getScopeRegistryProjection().defaultScopeId;
  if (!chatPool) return handle.listSessions(resolvedScopeId);
  const daemonEntries = chatPool.list(resolvedScopeId);
  const daemonIds = new Set(daemonEntries.map((session) => session.id));
  const serveSessions = handle
    .listSessions(resolvedScopeId)
    .filter((session) => !daemonIds.has(session.id))
    .map((session) => ({ ...session, source: "serve" as const }));
  return [...serveSessions, ...daemonEntries];
}
