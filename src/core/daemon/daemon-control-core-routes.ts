import type { IncomingMessage } from "node:http";
import type { ControlRouteRegistration } from "#core/modules/module-types.js";
import type { ModuleSetupJsonValue } from "#core/modules/setup-requirements.js";
import type { BuiltinControlRouteDeps } from "./daemon-control-routes.js";
import type { DaemonLiveStatus, InteractiveSession } from "./daemon-control-types.js";
import {
  jsonResponse,
  parseActiveScopePatchBody,
  readBody,
  resolveScopeIdParam,
} from "./daemon-control-utils.js";
import { decodeScopeAuthorityMutation } from "./scope-authority-codec.js";
import {
  SCOPE_AUTHORITY_OPERATOR_CHALLENGE_HEADER,
  SCOPE_AUTHORITY_OPERATOR_CHALLENGE_PATH,
  SCOPE_AUTHORITY_OPERATOR_PROOF_HEADER,
} from "./scope-authority-operator-token.js";
import type { ScopeAuthorityFailure, ScopeAuthorityMutation } from "./scope-authority-types.js";
import { SCOPE_AUTHORITY_OPERATOR_ACTION_HEADER } from "./scope-authority-types.js";
import type { ScopeId } from "./scope-registry.js";

type ParsedAuthorityBody =
  | { ok: true; value: ScopeAuthorityMutation }
  | { ok: false; message: string };

function listInteractiveSessions(
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
        const scope = resolveScopeIdParam(h, new URL(req.url ?? "/", "http://127.0.0.1"));
        if (!scope.ok) {
          jsonResponse(res, scope.status, scope.error);
          return;
        }
        const body: DaemonLiveStatus = {
          ...h.getDaemonLiveState(),
          workflow: h.getWorkflowLiveStatus(scope.scopeId),
          sessions: listInteractiveSessions(deps, scope.scopeId),
          channels: h.listChannelStatuses(),
        };
        jsonResponse(res, 200, body);
      },
    },
    {
      method: "GET",
      path: "/scopes",
      capabilityScope: "read",
      handler: (_req, res) => jsonResponse(res, 200, {
        ...h.getScopeRegistryProjection(),
        activeScopeId: h.getActiveScopeId(),
      }),
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
      path: "/scopes/active",
      capabilityScope: "read",
      handler: (_req, res) => jsonResponse(res, 200, { activeScopeId: h.getActiveScopeId() }),
    },
    {
      method: "PATCH",
      path: "/scopes/active",
      capabilityScope: "control",
      handler: async (req, res) => {
        const next = parseActiveScopePatchBody((await readBody(req)).toString("utf8"));
        if (!next.ok) {
          jsonResponse(res, 400, next.error);
          return;
        }
        const result = h.setActiveScopeId(next.scopeId);
        if (!result.ok) {
          if (result.reason === "not_hosted") {
            jsonResponse(res, 409, {
              error: `Scope ${result.scopeId} is ${result.state}`,
              reason: "scope_not_hosted",
              scopeId: result.scopeId,
              state: result.state,
            });
            return;
          }
          jsonResponse(res, 404, {
            error: "Unknown scope",
            reason: "unknown_scope",
            scopeId: result.scopeId,
          });
          return;
        }
        jsonResponse(res, 200, { activeScopeId: result.activeScopeId });
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
    {
      method: "GET",
      path: "/lifecycle/status",
      capabilityScope: "read",
      handler: async (req, res) => {
        if (!h.getLifecycleStatus) {
          jsonResponse(res, 501, { error: "Lifecycle collector is unavailable" });
          return;
        }
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const scopeId = url.searchParams.get("scopeId") ?? undefined;
        try {
          const report = await h.getLifecycleStatus({ scopeId });
          jsonResponse(res, 200, report);
        } catch (error) {
          jsonResponse(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    {
      method: "POST",
      path: "/lifecycle/sweep",
      capabilityScope: "control",
      handler: async (req, res) => {
        if (!h.runLifecycleSweep) {
          jsonResponse(res, 501, { error: "Lifecycle collector is unavailable" });
          return;
        }
        const rawBody = await readBody(req);
        let body: { dryRun?: boolean; scopeId?: string; targetRunId?: string } = {};
        if (rawBody.length > 0) {
          try {
            body = JSON.parse(rawBody.toString("utf8"));
          } catch {
            jsonResponse(res, 400, { error: "Request body must be valid JSON" });
            return;
          }
        }
        try {
          const report = await h.runLifecycleSweep(body);
          jsonResponse(res, 200, report);
        } catch (error) {
          jsonResponse(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
  ];
}
