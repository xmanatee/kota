/**
 * Static web UI route registrations contributed by the `web` module.
 *
 * Runtime hosts pass their project directory so the daemon and `kota serve`
 * resolve the same `clients/web/dist` path from the same module context.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
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

export type StaticWebUiRoutesOptions = {
  /** Explicit built UI directory. Mostly useful for tests. */
  webUiDir?: string;
  /** Project directory containing `clients/web/dist`. */
  projectDir?: string;
};

function resolveWebUiDir(options: StaticWebUiRoutesOptions): string | undefined {
  if (options.webUiDir !== undefined) return options.webUiDir;
  if (options.projectDir !== undefined) {
    return resolve(options.projectDir, "clients", "web", "dist");
  }
  return undefined;
}

function serveIndex(
  _req: IncomingMessage,
  res: ServerResponse,
  options: StaticWebUiRoutesOptions,
): void {
  const dir = resolveWebUiDir(options);
  if (!dir) {
    jsonResponse(res, 404, { error: "Web UI not installed" });
    return;
  }
  const indexPath = join(dir, "index.html");
  if (!isReadableFile(indexPath)) {
    jsonResponse(res, 404, { error: "Web UI not installed" });
    return;
  }

  const html = readFileSync(indexPath, "utf-8");
  setCors(res);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function serveAsset(
  req: IncomingMessage,
  res: ServerResponse,
  options: StaticWebUiRoutesOptions,
): void {
  const dir = resolveWebUiDir(options);
  if (!dir) {
    jsonResponse(res, 404, { error: "Not found" });
    return;
  }
  const assetPath = resolveAssetPath(dir, req);
  if (!assetPath || !isReadableFile(assetPath)) {
    jsonResponse(res, 404, { error: "Not found" });
    return;
  }

  const data = readFileSync(assetPath);
  const ext = extname(assetPath);
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  setCors(res);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  res.end(data);
}

function resolveAssetPath(dir: string, req: IncomingMessage): string | null {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (!pathname.startsWith("/assets/")) return null;

  const relativeAssetPath = pathname.slice("/assets/".length);
  if (!relativeAssetPath) return null;

  const assetsRoot = resolve(dir, "assets");
  const assetPath = resolve(assetsRoot, relativeAssetPath);
  if (assetPath !== assetsRoot && !assetPath.startsWith(`${assetsRoot}${sep}`)) {
    return null;
  }

  return assetPath;
}

function isReadableFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

export function staticWebUiRoutes(
  options: StaticWebUiRoutesOptions = {},
): RouteRegistration[] {
  return [
    { method: "GET", path: "/", handler: (req, res) => serveIndex(req, res, options) },
    { method: "GET", path: "/index.html", handler: (req, res) => serveIndex(req, res, options) },
    {
      method: "GET",
      path: "/assets/*rest",
      handler: (req, res) => serveAsset(req, res, options),
    },
  ];
}
