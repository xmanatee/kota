import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ControlRouteRegistration,
  RouteRegistration,
} from "#core/modules/module-types.js";
import { selectedScopeSelectorIdOrErrorResponse } from "#core/server/scope-selector-request.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import type { RetractRequest, RetractTarget } from "./client.js";
import { RETRACT_TARGET_ORDER, type RetractProvider } from "./retract-types.js";
import type { ResolveRetractScopeContext } from "./scope-context.js";

type RequestParseResult =
  | { ok: true; request: RetractRequest }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseRetractRequestBody(value: unknown): RequestParseResult {
  if (!isRecord(value)) return { ok: false, error: "request body is required" };
  if (
    typeof value.target !== "string" ||
    !(RETRACT_TARGET_ORDER as readonly string[]).includes(value.target)
  ) {
    return { ok: false, error: "target is invalid" };
  }
  if (typeof value.identifier !== "string" || value.identifier.trim() === "") {
    return { ok: false, error: "identifier is required" };
  }
  const extras = Object.keys(value).filter(
    (key) => key !== "target" && key !== "identifier" && key !== "scopeId",
  );
  if (extras.length > 0) return { ok: false, error: `unknown field "${extras[0]}"` };
  if (
    value.scopeId !== undefined &&
    (typeof value.scopeId !== "string" || value.scopeId.trim() === "")
  ) {
    return { ok: false, error: "scopeId must be a non-empty string" };
  }
  return {
    ok: true,
    request: {
      target: value.target as RetractTarget,
      identifier: value.identifier,
      ...(typeof value.scopeId === "string" && { scopeId: value.scopeId }),
    },
  };
}

export function createRetractRouteHandler(
  resolveProvider: () => RetractProvider,
  resolveScopeContext: ResolveRetractScopeContext,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    let body: unknown;
    try {
      body = await readBody(req);
    } catch {
      jsonResponse(res, 400, { error: "Invalid request body" });
      return;
    }
    const parsed = parseRetractRequestBody(body);
    if (!parsed.ok) {
      jsonResponse(res, 400, { error: parsed.error });
      return;
    }
    try {
      const selectedId = selectedScopeSelectorIdOrErrorResponse(res, parsed.request);
      if (selectedId === null) return;
      const scope = resolveScopeContext(selectedId);
      if ("error" in scope) {
        jsonResponse(res, 404, {
          error: "Unknown scope",
          reason: "unknown_scope",
          scopeId: scope.scopeId,
        });
        return;
      }
      jsonResponse(res, 200, await resolveProvider().retract(parsed.request, scope));
    } catch (error) {
      jsonResponse(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

export function retractControlRoutes(
  resolveProvider: () => RetractProvider,
  resolveScopeContext: ResolveRetractScopeContext,
): ControlRouteRegistration[] {
  return [{
    method: "POST",
    path: "/retract",
    capabilityScope: "control",
    handler: createRetractRouteHandler(resolveProvider, resolveScopeContext),
  }];
}

export function retractApiRoutes(
  resolveProvider: () => RetractProvider,
  resolveScopeContext: ResolveRetractScopeContext,
): RouteRegistration[] {
  return [{
    method: "POST",
    path: "/api/retract",
    handler: createRetractRouteHandler(resolveProvider, resolveScopeContext),
  }];
}
