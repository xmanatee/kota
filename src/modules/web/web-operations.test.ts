/**
 * Local-handler unit tests for the `web` namespace.
 *
 * Boot-time behavior pinned here:
 * - The web server boots even when no autonomy posture is configured. The
 *   posture resolution is deferred to session creation, so monitoring/status
 *   routes stay reachable on a "cold" install.
 * - Per-session enforcement still runs through the same resolver and surfaces
 *   the canonical error if no posture is configured.
 *
 * The local handler drives `loadRuntimeModules` so module-contributed routes
 * (provider-backed: `/api/knowledge`, `/api/memory`, ...) are registered
 * before `startServer` runs. These tests stub the loader so they stay
 * hermetic: only the server-boot behavior is under test here. The
 * `built-cli-serve.integration.test.ts` smoke covers the real runtime-load
 * path through `node dist/cli.js serve`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaConfig } from "#core/config/config.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { localWebClient } from "./web-operations.js";

// The daemon-link inside startServer asks the runtime loader to assemble
// module-contributed daemon handlers. As namespaces migrate out of
// buildCoreStubDaemonClientHandlers, the hermetic stub here must cover
// each migrated namespace through `buildMigratedNamespaceTestStubs`.
vi.mock("#core/modules/runtime-loader.js", async () => {
  const stubs = await import("#core/server/daemon-client-test-stubs.js");
  return {
    loadRuntimeModules: vi.fn(async () => ({
      getRoutes: () => [],
      getRegisteredConfigKeys: () => new Set<string>(),
      assembleDaemonClientHandlers: () => stubs.buildMigratedNamespaceTestStubs(),
    })),
  };
});

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

  afterEach(async () => {
    const httpModule = require("node:http") as typeof import("node:http");
    httpModule.Server.prototype.listen = originalListen;
    if (listenSpyServer) await closeServer(listenSpyServer);
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

  it("warns when serve ignores untrusted project config", async () => {
    mkdirSync(join(cwd, ".kota"), { recursive: true });
    writeFileSync(
      join(cwd, ".kota", "config.json"),
      JSON.stringify({
        serve: { noAuth: true },
        guardrails: { toolOverrides: { process: "allow" } },
      }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let warnings = "";
    try {
      await localWebClient(stubCtx(cwd, {})).start({ port: 0, noAuth: true });
      warnings = warnSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    } finally {
      warnSpy.mockRestore();
    }
    expect(warnings).toContain("ignored untrusted project config");
    expect(warnings).toContain(join(cwd, ".kota", "config.json"));
    expect(warnings).toContain("server/auth posture (serve)");
    expect(warnings).toContain("trustedProjects");
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

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
