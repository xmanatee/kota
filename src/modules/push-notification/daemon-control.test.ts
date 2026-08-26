/**
 * Exercises the push-notification module's daemon-control route through the
 * same registration seam the real daemon uses: `pushNotificationControlRoutes
 * (scopeRoot)` is the module's contribution, so the test mounts the handler
 * on a live `DaemonControlServer` and hits `POST /push-tokens` via HTTP.
 *
 * Covers the wire contract migrated out of core: bearer-token auth, the
 * `control` capability scope, JSON body `{ token, deviceId }` validation,
 * `400 { error: "Invalid JSON body" }` on parse failure,
 * `400 { error: "token and deviceId are required" }` on missing fields, and
 * `200 { ok: true }` on success. Persisted state under
 * `<scopeRoot>/.kota/push-tokens.json` is asserted directly so the wire
 * contract and the file format both stay covered by one test.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DaemonControlHandle,
  DaemonControlServer,
  type WorkflowMetricCounts,
} from "#core/daemon/daemon-control.js";
import { daemonSetupControlHandleStubs } from "#core/daemon/daemon-setup-control-test-stubs.js";
import { pushNotificationControlRoutes } from "./routes.js";

const TEST_TOKEN = "push-notification-test-token";

function makeHandle(): DaemonControlHandle {
  return {
    getDaemonLiveState: vi.fn(() => ({
      startedAt: "2026-01-01T00:00:00.000Z",
      pid: 1,
      running: true,
    })),
    getHealthStatus: vi.fn(() => ({
      scheduler: "ok" as const,
      modules: "ok" as const,
    })),
    getWorkflowLiveStatus: vi.fn(() => ({
      activeRuns: [],
      pendingRuns: [],
      queueLength: 0,
      completedRuns: 0,
      workflows: {},
      paused: false,
      concurrency: 4,
    })),
    listChannelStatuses: vi.fn(() => []),
    pauseWorkflowDispatch: vi.fn(() => ({ already: false })),
    resumeWorkflowDispatch: vi.fn(() => ({ already: false })),
    abortActiveRuns: vi.fn(() => ({ aborted: 0 })),
    abortActiveRun: vi.fn(() => ({ ok: false, notFound: true })),
    reloadWorkflowDefinitions: vi.fn(() => ({ count: 0 })),
    getWorkflowDefinitions: vi.fn(() => []),
    enableWorkflow: vi.fn(() => ({ ok: true })),
    disableWorkflow: vi.fn(() => ({ ok: true })),
    enqueuePendingRun: vi.fn(() => ({ ok: true })),
    cancelQueuedRun: vi.fn(() => ({ ok: false, notFound: true })),
    subscribeToEvents: vi.fn(() => () => {}),
    listWorkflowRuns: vi.fn(() => []),
    getWorkflowRun: vi.fn(() => null),
    getWorkflowMetricCounts: vi.fn((): WorkflowMetricCounts => ({
      runCounts: [],
      costTotals: [],
      durationHistogram: [],
      deadLetterCounts: { open: 0, dismissed: 0, redriven: 0 },
    })),
    registerSession: vi.fn(),
    unregisterSession: vi.fn(),
    listSessions: vi.fn(() => []),
    setSessionAutonomyMode: vi.fn(() => ({ ok: false, notFound: true })),
    getScopeRegistryProjection: vi.fn(() => ({ rootScopeId: "global", defaultScopeId: "test-scope-id", scopes: [{ scopeId: "global", displayName: "Global" }, { scopeId: "test-scope-id", parentScopeId: "global", directoryRoot: "/tmp/test-scope", displayName: "test-scope" }] })),
    hasScope: vi.fn((id: string) => id === "test-scope-id"),
    getActiveScopeId: vi.fn(() => null),
    setActiveScopeId: vi.fn((id: string | null) => (id === null ? { ok: true as const, activeScopeId: null } : id === "test-scope-id" ? { ok: true as const, activeScopeId: id } : { ok: false as const, reason: "not_found" as const, scopeId: id })),
    reloadConfig: vi.fn(async () => ({ workflows: 0, changedModules: [], sessionGuardrails: { refreshed: 0, unchanged: 0, nonRefreshable: [] } })),
    probeCapabilityReadiness: vi.fn(async () => ({ capabilities: [], summary: { ready: 0, unavailable: 0, init_failed: 0 } })),
    getClientIdentity: vi.fn(async () => ({
      scopeName: "test-scope",
      scopeRoot: "/tmp/test-scope",
      scopeRegistry: { rootScopeId: "global", defaultScopeId: "test-scope-id", scopes: [{ scopeId: "global", displayName: "Global" }, { scopeId: "test-scope-id", parentScopeId: "global", directoryRoot: "/tmp/test-scope", displayName: "test-scope" }] },
      daemonVersion: "0.1.0",
      pid: 9999,
      startedAt: "2026-01-01T00:00:00.000Z",
      dashboard: {
        available: false as const,
        reason: "not_contributed",
        message: "No module contributed a dashboard capability.",
      },
    })),
    ...daemonSetupControlHandleStubs(),
  };
}

async function postJson(
  port: number,
  path: string,
  body: unknown,
  init: RequestInit = {},
): Promise<Response> {
  return globalThis.fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TEST_TOKEN}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...init,
  });
}

describe("push-notification module daemon-control routes", () => {
  let server: DaemonControlServer;
  let port: number;
  let scopeRoot: string;

  beforeEach(async () => {
    scopeRoot = mkdtempSync(join(tmpdir(), "kota-push-notification-control-"));
    mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
    server = new DaemonControlServer(makeHandle(), TEST_TOKEN, {
      controlRoutes: pushNotificationControlRoutes(scopeRoot),
    });
    port = await server.start();
  });

  afterEach(async () => {
    await server.stop();
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  describe("registration seam", () => {
    it("declares POST /push-tokens with control capability scope", () => {
      const routes = pushNotificationControlRoutes(scopeRoot);
      expect(routes.map((r) => `${r.method} ${r.path} (${r.capabilityScope})`)).toEqual([
        "POST /push-tokens (control)",
      ]);
    });

    it("requires the daemon bearer token", async () => {
      const res = await globalThis.fetch(`http://127.0.0.1:${port}/push-tokens`, {
        method: "POST",
      });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /push-tokens", () => {
    it("registers a push token and returns 200 { ok: true }", async () => {
      const res = await postJson(port, "/push-tokens", {
        deviceId: "test-device-1",
        token: "ExponentPushToken[abc123]",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      const stored = JSON.parse(
        readFileSync(join(scopeRoot, ".kota/push-tokens.json"), "utf-8"),
      ) as { tokens: Record<string, { token: string; deviceId: string; registeredAt: string }> };
      expect(stored.tokens["test-device-1"].token).toBe("ExponentPushToken[abc123]");
      expect(stored.tokens["test-device-1"].deviceId).toBe("test-device-1");
      expect(typeof stored.tokens["test-device-1"].registeredAt).toBe("string");
    });

    it("returns 400 { error: 'Invalid JSON body' } when the body is not valid JSON", async () => {
      const res = await globalThis.fetch(`http://127.0.0.1:${port}/push-tokens`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TEST_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: "not json",
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid JSON body" });
    });

    it("returns 400 when the token is missing", async () => {
      const res = await postJson(port, "/push-tokens", { deviceId: "test-device-1" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "token and deviceId are required",
      });
    });

    it("returns 400 when the deviceId is missing", async () => {
      const res = await postJson(port, "/push-tokens", {
        token: "ExponentPushToken[abc123]",
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "token and deviceId are required",
      });
    });

    it("rejects mutating routes when bearer token is absent (control scope still requires auth)", async () => {
      const res = await globalThis.fetch(`http://127.0.0.1:${port}/push-tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "x", deviceId: "y" }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("collision detection", () => {
    it("throws at server construction if two contributions claim the same route key", () => {
      const collision = [
        ...pushNotificationControlRoutes(scopeRoot),
        {
          method: "POST" as const,
          path: "/push-tokens",
          capabilityScope: "control" as const,
          handler: (
            _req: unknown,
            res: { writeHead: (s: number) => void; end: () => void },
          ) => {
            res.writeHead(500);
            res.end();
          },
        },
      ];
      expect(
        () =>
          new DaemonControlServer(makeHandle(), TEST_TOKEN, {
            controlRoutes: collision as never,
          }),
      ).toThrow(/collides/);
    });
  });
});
