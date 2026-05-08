import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  DaemonControlHandle,
  UnknownProjectError,
} from "./daemon-control-types.js";
import type { ProjectId } from "./project-registry.js";

export function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(data);
}

/**
 * Result of resolving a `?projectId=` query parameter against the daemon's
 * configured projects. Either resolves to an explicit `projectId`
 * (undefined for "use default") or rejects with the typed
 * {@link UnknownProjectError} the route handler returns as a 404 body.
 */
export type ProjectScopeParam =
  | { ok: true; projectId: ProjectId | undefined }
  | { ok: false; error: UnknownProjectError };

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
 * Read and validate the optional `?projectId=` query parameter for a
 * project-scoped control-API route.
 *
 * - When the parameter is absent or empty, returns the operator-selected
 *   active project id from the handle, or `{ projectId: undefined }` when
 *   no selection is in force so the handle resolves the registry's
 *   default project.
 * - When the parameter is present, validates against
 *   {@link DaemonControlHandle.hasProject}. Unknown ids return the
 *   typed wire-shape rejection that route handlers translate to a 404.
 */
export function resolveProjectIdParam(
  handle: DaemonControlHandle,
  url: URL,
): ProjectScopeParam {
  const raw = url.searchParams.get("projectId");
  if (raw === null || raw === "") {
    const active = handle.getActiveProjectId();
    return { ok: true, projectId: active ?? undefined };
  }
  if (!handle.hasProject(raw)) {
    return {
      ok: false,
      error: {
        error: "Unknown project",
        reason: "unknown_project",
        projectId: raw,
      },
    };
  }
  return { ok: true, projectId: raw };
}
