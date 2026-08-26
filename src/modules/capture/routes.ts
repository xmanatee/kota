/**
 * HTTP routes for the cross-store capture seam.
 *
 * Two surfaces share one handler:
 * - `POST /capture` on the daemon-control server (capability scope
 *   `control`, since the seam mutates persisted state), consumed by
 *   other daemon clients through `KotaClient.capture.capture()`.
 * - `POST /api/capture` on the user-facing HTTP server, consumed by the
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
import {
  CAPTURE_TARGET_ORDER,
  type CaptureProvider,
} from "./capture-types.js";
import type {
  CaptureFilter,
  CaptureResult,
  CaptureTarget,
} from "./client.js";
import type { ResolveCaptureScopeContext } from "./scope-context.js";

function parseFilter(value: unknown): CaptureFilter | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const filter: CaptureFilter = {};
  if (typeof raw.target === "string") {
    if ((CAPTURE_TARGET_ORDER as readonly string[]).includes(raw.target)) {
      filter.target = raw.target as CaptureTarget;
    }
  }
  if (typeof raw.hint === "string" && raw.hint !== "") {
    filter.hint = raw.hint;
  }
  if (typeof raw.scopeId === "string" && raw.scopeId.trim() !== "") {
    filter.scopeId = raw.scopeId;
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
}

export function createCaptureRouteHandler(
  resolveProvider: () => CaptureProvider,
  resolveScopeContext?: ResolveCaptureScopeContext,
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
    const text = typeof body.text === "string" ? body.text : "";
    if (text.trim() === "") {
      jsonResponse(res, 400, { error: "text is required" });
      return;
    }
    const filter = parseFilter(body.filter);
    try {
      const selectedId = selectedScopeSelectorIdOrErrorResponse(res, filter);
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
      const result = await provider.capture(text, filter, scope);
      jsonResponse(res, 200, result satisfies CaptureResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      jsonResponse(res, 500, { error: message });
    }
  };
}

export function captureControlRoutes(
  resolveProvider: () => CaptureProvider,
  resolveScopeContext?: ResolveCaptureScopeContext,
): ControlRouteRegistration[] {
  return [
    {
      method: "POST",
      path: "/capture",
      capabilityScope: "control",
      handler: createCaptureRouteHandler(resolveProvider, resolveScopeContext),
    },
  ];
}

export function captureApiRoutes(
  resolveProvider: () => CaptureProvider,
  resolveScopeContext?: ResolveCaptureScopeContext,
): RouteRegistration[] {
  return [
    {
      method: "POST",
      path: "/api/capture",
      handler: createCaptureRouteHandler(resolveProvider, resolveScopeContext),
    },
  ];
}
