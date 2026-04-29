/**
 * Local-handler unit tests for the `web` namespace.
 *
 * Boot-time behavior pinned here:
 * - The web server boots even when no autonomy posture is configured. The
 *   posture resolution is deferred to session creation, so monitoring/status
 *   routes stay reachable on a "cold" install.
 * - Per-session enforcement still runs through the same resolver and surfaces
 *   the canonical error if no posture is configured.
 */

import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KotaConfig } from "#core/config/config.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { localWebClient } from "./web-operations.js";

function stubCtx(cwd: string, config: KotaConfig = {}): ModuleContext {
  return {
    cwd,
    config,
    getRoutes: () => [],
    getRegisteredConfigKeys: () => new Set<string>(),
  } as unknown as ModuleContext;
}

async function fetchJson(port: number, path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON body, keep raw text */
  }
  return { status: response.status, body };
}

function trackedServer(): { servers: Server[]; track: (s: Server) => Server } {
  const servers: Server[] = [];
  return {
    servers,
    track(s: Server) {
      servers.push(s);
      return s;
    },
  };
}

describe("web local handler cold-start", () => {
  let cwd: string;
  let savedKey: string | undefined;
  let originalListen: typeof import("node:http").Server.prototype.listen;
  let listenSpyServer: Server | null = null;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kota-web-ops-"));
    savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    listenSpyServer = null;

    const httpModule = require("node:http") as typeof import("node:http");
    originalListen = httpModule.Server.prototype.listen;
    httpModule.Server.prototype.listen = function patched(this: Server, ...args: unknown[]) {
      listenSpyServer = this;
      return originalListen.apply(this, args as Parameters<typeof originalListen>);
    } as typeof originalListen;
  });

  afterEach(() => {
    const httpModule = require("node:http") as typeof import("node:http");
    httpModule.Server.prototype.listen = originalListen;
    if (listenSpyServer) listenSpyServer.close();
    rmSync(cwd, { recursive: true, force: true });
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
  });

  it("starts successfully when no autonomy posture is configured", async () => {
    const result = await localWebClient(stubCtx(cwd, {})).start({ port: 0, noAuth: true });
    expect(result).toEqual({ ok: true });
    expect(listenSpyServer).not.toBeNull();
  });

  it("serves /api/health on a freshly-booted server with no autonomy posture", async () => {
    await localWebClient(stubCtx(cwd, {})).start({ port: 0, noAuth: true });
    expect(listenSpyServer).not.toBeNull();
    const address = listenSpyServer?.address();
    if (!address || typeof address === "string") throw new Error("expected AddressInfo");
    const res = await fetchJson(address.port, "/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
  });

  it("rejects unconfigured-posture session creation with the canonical resolver error", async () => {
    await localWebClient(stubCtx(cwd, {})).start({ port: 0, noAuth: true });
    expect(listenSpyServer).not.toBeNull();
    const address = listenSpyServer?.address();
    if (!address || typeof address === "string") throw new Error("expected AddressInfo");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("autonomy mode is not configured");
  });
});
