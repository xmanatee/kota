import type { IncomingMessage, ServerResponse } from "node:http";
import {
  resolveScopeSelectorFromUrl,
} from "#core/server/scope-selector.js";
import type {
  ConflictingScopeSelectorsError,
  DaemonControlHandle,
  UnknownProjectError,
  UnknownScopeError,
} from "./daemon-control-types.js";
import type { ProjectId } from "./scope-registry.js";

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
 * Result of resolving `?scopeId=` / `?projectId=` query parameters against
 * the daemon's configured directory scopes. Either resolves to the internal
 * directory-scope compatibility id (`projectId`, undefined for "use
 * default") or rejects with the typed error and status the route handler
 * returns.
 */
export type ProjectScopeParam =
  | { ok: true; projectId: ProjectId | undefined }
  | {
      ok: false;
      status: 400 | 404;
      error:
        | UnknownProjectError
        | UnknownScopeError
        | ConflictingScopeSelectorsError;
    };

/**
 * Result of parsing the `PATCH /projects/active` request body. The
 * `ok` arm carries the validated `projectId` (`null` clears the
 * selection); the rejection arm names the wire error the route handler
 * returns as a 400 body.
 */
export type ActiveProjectPatchBody =
  | { ok: true; projectId: string | null }
  | { ok: false; error: { error: string; reason: "invalid_request" } };

type ActiveProjectPatchInput = { projectId?: string | null };

/**
 * Parse and validate the JSON body of `PATCH /projects/active`. The
 * boundary cast lives here so the route handler stays free of raw
 * `unknown` casts; the stable wire contract is the typed
 * {@link ActiveProjectPatchBody} sum returned to the route.
 */
export function parseActiveProjectPatchBody(raw: string): ActiveProjectPatchBody {
  let parsed: ActiveProjectPatchInput;
  try {
    parsed = JSON.parse(raw || "{}") as ActiveProjectPatchInput;
  } catch {
    return { ok: false, error: { error: "Invalid JSON body", reason: "invalid_request" } };
  }
  const next = parsed.projectId;
  if (next !== null && next !== undefined && typeof next !== "string") {
    return {
      ok: false,
      error: {
        error: "projectId must be a string or null",
        reason: "invalid_request",
      },
    };
  }
  return { ok: true, projectId: next ?? null };
}

/**
 * Read and validate optional `?scopeId=` / `?projectId=` query parameters for
 * a scope-scoped control-API route.
 *
 * - When both parameters are absent or empty, returns the operator-selected
 *   active directory-scope id from the handle, or `{ projectId: undefined }`
 *   when no selection is in force so the handle resolves the registry's
 *   default directory scope.
 * - When both parameters are present, they must match exactly; mismatches are
 *   rejected as a malformed request instead of choosing one silently.
 * - When a parameter is present, validates against
 *   {@link DaemonControlHandle.hasProject}. Unknown ids return the
 *   typed wire-shape rejection that route handlers translate to a 404. The
 *   error vocabulary follows the caller's selector spelling.
 */
export function resolveProjectIdParam(
  handle: DaemonControlHandle,
  url: URL,
): ProjectScopeParam {
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
    const active = handle.getActiveProjectId();
    return { ok: true, projectId: active ?? undefined };
  }
  if (!handle.hasProject(selected)) {
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
        error: "Unknown project",
        reason: "unknown_project",
        projectId: selected,
      },
    };
  }
  return { ok: true, projectId: selected };
}
