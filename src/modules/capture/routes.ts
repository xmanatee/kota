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
import type { CaptureFilter, CaptureTarget } from "./client.js";
import type { ResolveCaptureScopeContext } from "./scope-context.js";

type ParsedCaptureRequest =
  | { ok: true; text: string; filter?: CaptureFilter }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseCaptureRequestBody(value: unknown): ParsedCaptureRequest {
  if (!isRecord(value)) return { ok: false, error: "request body is required" };
  if (typeof value.text !== "string" || value.text.trim() === "") {
    return { ok: false, error: "text is required" };
  }
  const extras = Object.keys(value).filter(
    (key) => key !== "text" && key !== "filter",
  );
  if (extras.length > 0) return { ok: false, error: `unknown field "${extras[0]}"` };
  if (value.filter === undefined) return { ok: true, text: value.text };
  if (!isRecord(value.filter)) return { ok: false, error: "filter must be an object" };
  const raw = value.filter;
  const filter: CaptureFilter = {};
  if (raw.target !== undefined) {
    if (
      typeof raw.target !== "string" ||
      !(CAPTURE_TARGET_ORDER as readonly string[]).includes(raw.target)
    ) {
      return { ok: false, error: "filter.target is invalid" };
    }
    filter.target = raw.target as CaptureTarget;
  }
  if (raw.hint !== undefined) {
    if (typeof raw.hint !== "string") {
      return { ok: false, error: "filter.hint must be a string" };
    }
    if (raw.hint !== "") filter.hint = raw.hint;
  }
  if (raw.scopeId !== undefined) {
    if (typeof raw.scopeId !== "string" || raw.scopeId.trim() === "") {
      return { ok: false, error: "filter.scopeId must be a non-empty string" };
    }
    filter.scopeId = raw.scopeId;
  }
  const filterExtras = Object.keys(raw).filter(
    (key) => key !== "target" && key !== "hint" && key !== "scopeId",
  );
  if (filterExtras.length > 0) {
    return { ok: false, error: `unknown filter field "${filterExtras[0]}"` };
  }
  return Object.keys(filter).length > 0
    ? { ok: true, text: value.text, filter }
    : { ok: true, text: value.text };
}

export function createCaptureRouteHandler(
  resolveProvider: () => CaptureProvider,
  resolveScopeContext: ResolveCaptureScopeContext,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    let body: unknown;
    try {
      body = await readBody(req);
    } catch {
      jsonResponse(res, 400, { error: "Invalid request body" });
      return;
    }
    const parsed = parseCaptureRequestBody(body);
    if (!parsed.ok) {
      jsonResponse(res, 400, { error: parsed.error });
      return;
    }
    try {
      const selectedId = selectedScopeSelectorIdOrErrorResponse(res, parsed.filter);
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
      jsonResponse(
        res,
        200,
        await resolveProvider().capture(parsed.text, parsed.filter, scope),
      );
    } catch (error) {
      jsonResponse(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

export function captureControlRoutes(
  resolveProvider: () => CaptureProvider,
  resolveScopeContext: ResolveCaptureScopeContext,
): ControlRouteRegistration[] {
  return [{
    method: "POST",
    path: "/capture",
    capabilityScope: "control",
    handler: createCaptureRouteHandler(resolveProvider, resolveScopeContext),
  }];
}

export function captureApiRoutes(
  resolveProvider: () => CaptureProvider,
  resolveScopeContext: ResolveCaptureScopeContext,
): RouteRegistration[] {
  return [{
    method: "POST",
    path: "/api/capture",
    handler: createCaptureRouteHandler(resolveProvider, resolveScopeContext),
  }];
}
