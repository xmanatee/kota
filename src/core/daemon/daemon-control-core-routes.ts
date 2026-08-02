import type { IncomingMessage } from "node:http";
import type { ControlRouteRegistration } from "#core/modules/module-types.js";
import type { ModuleSetupJsonValue } from "#core/modules/setup-requirements.js";
import type { BuiltinControlRouteDeps } from "./daemon-control-routes.js";
import type { DaemonLiveStatus, InteractiveSession } from "./daemon-control-types.js";
import {
  jsonResponse,
  parseActiveProjectPatchBody,
  readBody,
  resolveProjectIdParam,
} from "./daemon-control-utils.js";
import { decodeScopeAuthorityMutation } from "./scope-authority-codec.js";
import {
  SCOPE_AUTHORITY_OPERATOR_CHALLENGE_HEADER,
  SCOPE_AUTHORITY_OPERATOR_CHALLENGE_PATH,
  SCOPE_AUTHORITY_OPERATOR_PROOF_HEADER,
} from "./scope-authority-operator-token.js";
import type { ScopeAuthorityFailure, ScopeAuthorityMutation } from "./scope-authority-types.js";
import { SCOPE_AUTHORITY_OPERATOR_ACTION_HEADER } from "./scope-authority-types.js";
import type { ProjectId } from "./scope-registry.js";

type ParsedAuthorityBody =
  | { ok: true; value: ScopeAuthorityMutation }
  | { ok: false; message: string };

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

function parseScopeAuthorityBody(raw: Buffer): ParsedAuthorityBody {
  let parsed: ModuleSetupJsonValue;
  try {
    parsed = JSON.parse(raw.toString("utf8")) as ModuleSetupJsonValue;
  } catch {
    return { ok: false, message: "Request body must be valid JSON" };
  }
  const decoded = decodeScopeAuthorityMutation(parsed);
  return decoded.ok
    ? { ok: true, value: decoded.value }
    : { ok: false, message: decoded.error };
}

function scopeAuthorityFailureStatus(failure: ScopeAuthorityFailure): number {
  if (failure.reason === "unknown_scope") return 404;
  if (failure.reason === "invalid_request") return 400;
  if (failure.reason === "operator_action_required") return 403;
  if (failure.reason === "persistence_failed") return 500;
  return 409;
}

function parseScopeAuthorityOperatorAction(
  req: IncomingMessage,
  deps: BuiltinControlRouteDeps,
  scopeId: string,
  body: string,
) {
  const suppliedProof = req.headers[SCOPE_AUTHORITY_OPERATOR_PROOF_HEADER];
  const challenge = req.headers[SCOPE_AUTHORITY_OPERATOR_CHALLENGE_HEADER];
  if (typeof suppliedProof !== "string" || typeof challenge !== "string") return undefined;
  const value = req.headers[SCOPE_AUTHORITY_OPERATOR_ACTION_HEADER];
  if (value === "apply" || value === "confirm-dangerous") {
    return deps.handle.authorizeScopeAuthorityAction?.(
      { value, scopeId, body, challenge },
      suppliedProof,
    );
  }
  return undefined;
}

export function buildDaemonCoreControlRoutes(
  deps: BuiltinControlRouteDeps,
): ControlRouteRegistration[] {
  const h = deps.handle;
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
      method: "POST",
      path: SCOPE_AUTHORITY_OPERATOR_CHALLENGE_PATH,
      capabilityScope: "control",
      handler: (req, res) => {
        if (!h.answerScopeAuthorityOperatorChallenge) {
          jsonResponse(res, 501, { error: "Scope authority is unavailable" });
          return;
        }
        const challenge = req.headers[SCOPE_AUTHORITY_OPERATOR_CHALLENGE_HEADER];
        const proof = typeof challenge === "string"
          ? h.answerScopeAuthorityOperatorChallenge(challenge)
          : undefined;
        if (proof === undefined) {
          jsonResponse(res, 400, { error: "Invalid scope authority operator challenge" });
          return;
        }
        jsonResponse(res, 200, { proof });
      },
    },
    {
      method: "GET",
      path: "/status",
      capabilityScope: "read",
      handler: (req, res) => {
        const scope = resolveProjectIdParam(h, new URL(req.url ?? "/", "http://127.0.0.1"));
        if (!scope.ok) {
          jsonResponse(res, scope.status, scope.error);
          return;
        }
        const body: DaemonLiveStatus = {
          ...h.getDaemonLiveState(),
          workflow: h.getWorkflowLiveStatus(scope.projectId),
          sessions: listInteractiveSessions(deps, scope.projectId),
          channels: h.listChannelStatuses(),
        };
        jsonResponse(res, 200, body);
      },
    },
    {
      method: "GET",
      path: "/projects",
      capabilityScope: "read",
      handler: (_req, res) => jsonResponse(res, 200, {
        ...h.getProjectRegistryProjection(),
        activeProjectId: h.getActiveProjectId(),
      }),
    },
    {
      method: "GET",
      path: "/scopes",
      capabilityScope: "read",
      handler: (_req, res) => jsonResponse(res, 200, h.getScopeRegistryProjection()),
    },
    {
      method: "GET",
      path: "/scopes/:scopeId/policy",
      capabilityScope: "read",
      handler: (_req, res, params) => {
        if (!h.hasScope(params.scopeId)) {
          jsonResponse(res, 404, {
            error: "Unknown scope",
            reason: "unknown_scope",
            scopeId: params.scopeId,
          });
          return;
        }
        jsonResponse(res, 200, h.getScopePolicy(params.scopeId));
      },
    },
    {
      method: "GET",
      path: "/scopes/:scopeId/authority",
      capabilityScope: "read",
      handler: (_req, res, params) => {
        if (!h.inspectScopeAuthority) {
          jsonResponse(res, 501, { error: "Scope authority is unavailable" });
          return;
        }
        const result = h.inspectScopeAuthority(params.scopeId);
        if ("ok" in result && !result.ok) {
          jsonResponse(res, scopeAuthorityFailureStatus(result), result);
          return;
        }
        jsonResponse(res, 200, result);
      },
    },
    {
      method: "POST",
      path: "/scopes/:scopeId/authority/validate",
      capabilityScope: "control",
      handler: async (req, res, params) => {
        if (!h.validateScopeAuthority) {
          jsonResponse(res, 501, { error: "Scope authority is unavailable" });
          return;
        }
        const rawBody = await readBody(req);
        const body = parseScopeAuthorityBody(rawBody);
        if (!body.ok) {
          jsonResponse(res, 400, { ok: false, reason: "invalid_request", message: body.message });
          return;
        }
        const result = h.validateScopeAuthority(params.scopeId, body.value);
        jsonResponse(res, result.ok ? 200 : scopeAuthorityFailureStatus(result), result);
      },
    },
    {
      method: "PUT",
      path: "/scopes/:scopeId/authority",
      capabilityScope: "control",
      handler: async (req, res, params) => {
        if (!h.applyScopeAuthority) {
          jsonResponse(res, 501, { error: "Scope authority is unavailable" });
          return;
        }
        const rawBody = await readBody(req);
        const body = parseScopeAuthorityBody(rawBody);
        if (!body.ok) {
          jsonResponse(res, 400, { ok: false, reason: "invalid_request", message: body.message });
          return;
        }
        const result = await h.applyScopeAuthority(
          params.scopeId,
          body.value,
          parseScopeAuthorityOperatorAction(
            req,
            deps,
            params.scopeId,
            rawBody.toString("utf8"),
          ),
        );
        jsonResponse(res, result.ok ? 200 : scopeAuthorityFailureStatus(result), result);
      },
    },
    {
      method: "GET",
      path: "/projects/active",
      capabilityScope: "read",
      handler: (_req, res) => jsonResponse(res, 200, { activeProjectId: h.getActiveProjectId() }),
    },
    {
      method: "PATCH",
      path: "/projects/active",
      capabilityScope: "control",
      handler: async (req, res) => {
        const next = parseActiveProjectPatchBody((await readBody(req)).toString("utf8"));
        if (!next.ok) {
          jsonResponse(res, 400, next.error);
          return;
        }
        const result = h.setActiveProjectId(next.projectId);
        if (!result.ok) {
          if (result.reason === "not_hosted") {
            jsonResponse(res, 409, {
              error: `Project scope ${result.projectId} is ${result.state}`,
              reason: "scope_not_hosted",
              projectId: result.projectId,
              scopeId: result.projectId,
              state: result.state,
            });
            return;
          }
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
      handler: (_req, res) => h.probeCapabilityReadiness()
        .then((response) => jsonResponse(res, 200, response)),
    },
    {
      method: "GET",
      path: "/identity",
      capabilityScope: "read",
      handler: (_req, res) => h.getClientIdentity()
        .then((identity) => jsonResponse(res, 200, identity)),
    },
  ];
}
