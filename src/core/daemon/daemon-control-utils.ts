import type { IncomingMessage, ServerResponse } from "node:http";
import {
  resolveScopeSelectorFromUrl,
} from "#core/server/scope-selector.js";
import type {
  ConflictingScopeSelectorsError,
  DaemonControlHandle,
  ScopeNotHostedError,
  UnknownScopeError,
} from "./daemon-control-types.js";
import type { ScopeId } from "./scope-registry.js";

export class RequestBodyTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`Request body exceeds ${limitBytes} bytes`);
    this.name = "RequestBodyTooLargeError";
  }
}

export type ReadBodyOptions = {
  limitBytes?: number;
};

export function readBody(
  req: IncomingMessage,
  options: ReadBodyOptions = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const cleanup = (keepErrorListener = false) => {
      req.off("data", onData);
      req.off("end", onEnd);
      if (!keepErrorListener) req.off("error", onError);
    };
    const fail = (error: Error, keepErrorListener = false) => {
      if (settled) return;
      settled = true;
      cleanup(keepErrorListener);
      reject(error);
    };
    const onData = (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (
        options.limitBytes !== undefined &&
        totalBytes > options.limitBytes
      ) {
        fail(new RequestBodyTooLargeError(options.limitBytes), true);
        req.resume();
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks, totalBytes));
    };
    const onError = (error: Error) => fail(error);

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

export function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(data);
}

/**
 * Result of resolving `?scopeId=` against the daemon's configured directory
 * scopes. Either resolves to the canonical id (`scopeId`, undefined for "use
 * default") or rejects with the typed error and status returned by the route.
 */
export type ScopeParam =
  | { ok: true; scopeId: ScopeId | undefined }
  | {
      ok: false;
      status: 400 | 404 | 409;
      error:
        | UnknownScopeError
        | ScopeNotHostedError
        | ConflictingScopeSelectorsError;
    };

/**
 * Result of parsing the `PATCH /scopes/active` request body. The
 * `ok` arm carries the validated `scopeId` (`null` clears the
 * selection); the rejection arm names the wire error the route handler
 * returns as a 400 body.
 */
export type ActiveScopePatchBody =
  | { ok: true; scopeId: string | null }
  | { ok: false; error: { error: string; reason: "invalid_request" } };

type ActiveScopePatchInput = { scopeId?: string | null };

/**
 * Parse and validate the JSON body of `PATCH /scopes/active`. The
 * boundary cast lives here so the route handler stays free of raw
 * `unknown` casts; the stable wire contract is the typed
 * {@link ActiveScopePatchBody} sum returned to the route.
 */
export function parseActiveScopePatchBody(raw: string): ActiveScopePatchBody {
  let parsed: ActiveScopePatchInput;
  try {
    parsed = JSON.parse(raw || "{}") as ActiveScopePatchInput;
  } catch {
    return { ok: false, error: { error: "Invalid JSON body", reason: "invalid_request" } };
  }
  const next = parsed.scopeId;
  if (next !== null && next !== undefined && typeof next !== "string") {
    return {
      ok: false,
      error: {
        error: "scopeId must be a string or null",
        reason: "invalid_request",
      },
    };
  }
  return { ok: true, scopeId: next ?? null };
}

/**
 * Read and validate the optional `?scopeId=` query parameter for a
 * scope-scoped control-API route.
 *
 * - When the parameter is absent or empty, returns the operator-selected
 *   active directory-scope id from the handle, or `{ scopeId: undefined }`
 *   when no selection is in force so the handle resolves the registry's
 *   default directory scope.
 * - When a parameter is present, validates against
 *   {@link DaemonControlHandle.hasScope}. Registered but unhosted scopes
 *   return a typed 409; unknown ids return the typed wire-shape rejection that
 *   route handlers translate to a 404.
 */
export function resolveScopeIdParam(
  handle: DaemonControlHandle,
  url: URL,
): ScopeParam {
  const resolvedSelector = resolveScopeSelectorFromUrl(url);
  if (!resolvedSelector.ok) {
    return {
      ok: false,
      status: resolvedSelector.status,
      error: resolvedSelector.body,
    };
  }
  const selected = resolvedSelector.selectedId;
  if (!selected) {
    const active = handle.getActiveScopeId();
    return { ok: true, scopeId: active ?? undefined };
  }
  if (!handle.hasScope(selected)) {
    if (
      handle.getScopeRegistryProjection().scopes.some(
        (scope) => scope.scopeId === selected,
      )
    ) {
      return {
        ok: false,
        status: 409,
        error: {
          error: "Scope is not hosted",
          reason: "scope_not_hosted",
          scopeId: selected,
        },
      };
    }
    if (resolvedSelector.selector.scopeId) {
      return {
        ok: false,
        status: 404,
        error: {
          error: "Unknown scope",
          reason: "unknown_scope",
          scopeId: selected,
        },
      };
    }
    return {
      ok: false,
      status: 404,
      error: {
        error: "Unknown scope",
        reason: "unknown_scope",
        scopeId: selected,
      },
    };
  }
  return { ok: true, scopeId: selected };
}
