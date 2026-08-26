/**
 * HTTP routes for the cross-store retract seam.
 *
 * Two surfaces share one handler:
 * - `POST /retract` on the daemon-control server (capability scope
 *   `control`, since the seam mutates persisted state), consumed by
 *   other daemon clients through `KotaClient.retract.retract()`.
 * - `POST /api/retract` on the user-facing HTTP server, consumed by the
 *   web client. The same handler answers both so the wire shape cannot
 *   drift between operator surfaces.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ControlRouteRegistration,
  RouteRegistration,
} from "#core/modules/module-types.js";
import { selectedScopeSelectorIdOrErrorResponse } from "#core/server/scope-selector-request.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import type { RetractRequest, RetractResult } from "./client.js";
import type { RetractProvider } from "./retract-types.js";
import type { ResolveRetractScopeContext } from "./scope-context.js";

type RequestParseResult =
  | { ok: true; request: RetractRequest }
  | { ok: false; error: string };

export function parseRetractRequestBody(value: unknown): RequestParseResult {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "request body is required" };
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.target !== "string") {
    return { ok: false, error: "target is required" };
  }
  const scope =
    typeof raw.scopeId === "string" && raw.scopeId.trim() !== ""
      ? { scopeId: raw.scopeId }
      : {};
  switch (raw.target) {
    case "memory":
      if (typeof raw.id !== "string" || raw.id === "") {
        return { ok: false, error: "memory retract requires `id`" };
      }
      return { ok: true, request: { target: "memory", id: raw.id, ...scope } };
    case "knowledge":
      if (typeof raw.slug !== "string" || raw.slug === "") {
        return { ok: false, error: "knowledge retract requires `slug`" };
      }
      return { ok: true, request: { target: "knowledge", slug: raw.slug, ...scope } };
    case "tasks":
      if (typeof raw.id !== "string" || raw.id === "") {
        return { ok: false, error: "tasks retract requires `id`" };
      }
      return { ok: true, request: { target: "tasks", id: raw.id, ...scope } };
    case "inbox":
      if (typeof raw.path !== "string" || raw.path === "") {
        return { ok: false, error: "inbox retract requires `path`" };
      }
      return { ok: true, request: { target: "inbox", path: raw.path, ...scope } };
    default:
      return {
        ok: false,
        error: `unknown target "${String(raw.target)}"`,
      };
  }
}

export function createRetractRouteHandler(
  resolveProvider: () => RetractProvider,
  resolveScopeContext?: ResolveRetractScopeContext,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async function handler(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    let body: Record<string, unknown>;
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
      const scope = resolveScopeContext?.(selectedId);
      if (scope && "error" in scope) {
        jsonResponse(res, 404, {
          error: "Unknown scope",
          reason: "unknown_scope",
          scopeId: scope.scopeId,
        });
        return;
      }
      const provider = resolveProvider();
      const result = await provider.retract(parsed.request, scope);
      jsonResponse(res, 200, result satisfies RetractResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      jsonResponse(res, 500, { error: message });
    }
  };
}

export function retractControlRoutes(
  resolveProvider: () => RetractProvider,
  resolveScopeContext?: ResolveRetractScopeContext,
): ControlRouteRegistration[] {
  return [
    {
      method: "POST",
      path: "/retract",
      capabilityScope: "control",
      handler: createRetractRouteHandler(resolveProvider, resolveScopeContext),
    },
  ];
}

export function retractApiRoutes(
  resolveProvider: () => RetractProvider,
  resolveScopeContext?: ResolveRetractScopeContext,
): RouteRegistration[] {
  return [
    {
      method: "POST",
      path: "/api/retract",
      handler: createRetractRouteHandler(resolveProvider, resolveScopeContext),
    },
  ];
}
