/**
 * Static web UI route registrations contributed by the `web` module.
 *
 * The `serve` command resolves `clients/web/dist` once and hands the result
 * to `setWebUiDir`. The route handlers close over that resolved directory
 * via module-local state, which keeps directory resolution and the
 * "Web UI not built" warning in the serve command (the single owner) while
 * letting the route registrations remain pure data the loader can collect.
 */

import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join } from "node:path";
import type { RouteRegistration } from "#core/modules/module-types.js";
import { jsonResponse, setCors } from "#core/server/session-pool.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

let webUiDir: string | undefined;

/**
 * Set the resolved web UI directory used by the static route handlers.
 * Called by the serve command after it resolves `clients/web/dist`.
 * Pass `undefined` when the UI is not built so the handlers respond with
 * the "Web UI not installed" / "Not found" 404 fallback.
 */
export function setWebUiDir(dir: string | undefined): void {
  webUiDir = dir;
}

function serveIndex(_req: IncomingMessage, res: ServerResponse): void {
  if (!webUiDir) {
    jsonResponse(res, 404, { error: "Web UI not installed" });
    return;
  }
  try {
    const html = readFileSync(join(webUiDir, "index.html"), "utf-8");
    setCors(res);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } catch {
    jsonResponse(res, 404, { error: "Web UI not installed" });
  }
}

function serveAsset(req: IncomingMessage, res: ServerResponse): void {
  if (!webUiDir) {
    jsonResponse(res, 404, { error: "Not found" });
    return;
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  const safePath = url.pathname.replace(/\.\./g, "");
  try {
    const data = readFileSync(join(webUiDir, safePath));
    const ext = extname(safePath);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    setCors(res);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    res.end(data);
  } catch {
    jsonResponse(res, 404, { error: "Not found" });
  }
}

export function staticWebUiRoutes(): RouteRegistration[] {
  return [
    { method: "GET", path: "/", handler: serveIndex },
    { method: "GET", path: "/index.html", handler: serveIndex },
    {
      method: "GET",
      path: "/assets/",
      pathPattern: /^\/assets\//,
      handler: serveAsset,
    },
  ];
}
