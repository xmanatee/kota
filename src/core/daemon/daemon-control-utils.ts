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
 * Read and validate the optional `?projectId=` query parameter for a
 * project-scoped control-API route.
 *
 * - When the parameter is absent or empty, returns
 *   `{ ok: true, projectId: undefined }` so the handle resolves the
 *   registry's default project.
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
    return { ok: true, projectId: undefined };
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
