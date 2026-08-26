/**
 * Integration test for `GET /identity`.
 *
 * Boots `DaemonControlServer` against a stub handle that exercises the
 * dashboard-ready and dashboard-unavailable arms, then asserts the
 * route renders the typed `ClientIdentity` payload the thin-client
 * contract promises.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildClientIdentity,
  DASHBOARD_CAPABILITY_ID,
} from "./client-identity.js";
import {
  type DaemonControlHandle,
  DaemonControlServer,
  type WorkflowLiveStatus,
  type WorkflowMetricCounts,
} from "./daemon-control.js";
import { daemonSetupControlHandleStubs } from "./daemon-setup-control-test-stubs.js";

const TEST_TOKEN = "identity-test-token";

const stubScopes = {
  rootScopeId: "global",
  defaultScopeId: "test-scope-id",
  scopes: [
    {
      scopeId: "global",
      displayName: "Global",
    },
    {
      scopeId: "test-scope-id",
      parentScopeId: "global",
      directoryRoot: "/Users/operator/scopes/kota",
      displayName: "kota",
    },
  ],
};

function makeHandle(
  overrides: Partial<DaemonControlHandle> = {},
): DaemonControlHandle {
  const defaultWorkflowStatus: WorkflowLiveStatus = {
    activeRuns: [],
    pendingRuns: [],
    queueLength: 0,
    completedRuns: 0,
    workflows: {},
    paused: false,
    concurrency: 4,
  };
  const defaultIdentity = buildClientIdentity({
    scopeRoot: "/Users/operator/scopes/kota",
    pid: 12345,
    startedAt: "2026-04-29T01:00:00.000Z",
    capabilities: {
      capabilities: [
        {
          id: DASHBOARD_CAPABILITY_ID,
          moduleName: "web",
          status: "ready",
        },
      ],
      summary: { ready: 1, unavailable: 0, init_failed: 0 },
    },
    scopeRegistry: stubScopes,
  });
  return {
    getDaemonLiveState: vi.fn(() => ({
      startedAt: "2026-04-29T01:00:00.000Z",
      pid: 12345,
      running: true,
    })),
    getHealthStatus: vi.fn(() => ({
      scheduler: "ok" as const,
      modules: "ok" as const,
    })),
    getWorkflowLiveStatus: vi.fn(() => ({ ...defaultWorkflowStatus })),
    listChannelStatuses: vi.fn(() => []),
    pauseWorkflowDispatch: vi.fn(() => ({ already: false })),
    resumeWorkflowDispatch: vi.fn(() => ({ already: false })),
    abortActiveRuns: vi.fn(() => ({ aborted: 0 })),
    abortActiveRun: vi.fn(() => ({ ok: false, notFound: true })),
    reloadWorkflowDefinitions: vi.fn(() => ({ count: 0 })),
    getWorkflowDefinitions: vi.fn(() => []),
    enableWorkflow: vi.fn(() => ({ ok: true })),
    disableWorkflow: vi.fn(() => ({ ok: true })),
    enqueuePendingRun: vi.fn(() => ({ ok: true, queued: "any" })),
    cancelQueuedRun: vi.fn(() => ({ ok: false, notFound: true })),
    subscribeToEvents: vi.fn(() => () => {}),
    listWorkflowRuns: vi.fn(() => []),
    getWorkflowRun: vi.fn(() => null),
    getWorkflowMetricCounts: vi.fn(
      (): WorkflowMetricCounts => ({
        runCounts: [],
        costTotals: [],
        durationHistogram: [],
        deadLetterCounts: { open: 0, dismissed: 0, redriven: 0 },
      }),
    ),
    registerSession: vi.fn(),
    unregisterSession: vi.fn(),
    listSessions: vi.fn(() => []),
    setSessionAutonomyMode: vi.fn(() => ({ ok: false, notFound: true })),
    getScopeRegistryProjection: vi.fn(() => stubScopes),
    hasScope: vi.fn((id: string) => id === "test-scope-id"),
    getActiveScopeId: vi.fn(() => null),
    setActiveScopeId: vi.fn((id: string | null) => (id === null ? { ok: true as const, activeScopeId: null } : id === "test-scope-id" ? { ok: true as const, activeScopeId: id } : { ok: false as const, reason: "not_found" as const, scopeId: id })),
    reloadConfig: vi.fn(async () => ({ workflows: 0, changedModules: [] as string[], sessionGuardrails: { refreshed: 0, unchanged: 0, nonRefreshable: [] } })),
    probeCapabilityReadiness: vi.fn(async () => ({
      capabilities: [],
      summary: { ready: 0, unavailable: 0, init_failed: 0 },
    })),
    getClientIdentity: vi.fn(async () => defaultIdentity),
    ...daemonSetupControlHandleStubs(),
    ...overrides,
  };
}

describe("GET /identity", () => {
  let server: DaemonControlServer;
  let port: number;

  beforeEach(async () => {
    server = new DaemonControlServer(makeHandle(), TEST_TOKEN);
    port = await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("requires a bearer token (read scope)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/identity`);
    expect(res.status).toBe(401);
  });

  it("returns the typed identity payload with dashboard.available=true", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/identity`, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scopeName).toBe("kota");
    expect(body.scopeRoot).toBe("/Users/operator/scopes/kota");
    expect(body.daemonVersion).toBe("0.1.0");
    expect(body.pid).toBe(12345);
    expect(body.startedAt).toBe("2026-04-29T01:00:00.000Z");
    expect(body.dashboard).toEqual({ available: true, path: "/" });
  });

  it("surfaces dashboard.available=false with reason when the dashboard capability is unavailable", async () => {
    const handle = makeHandle({
      getClientIdentity: vi.fn(async () =>
        buildClientIdentity({
          scopeRoot: "/Users/operator/scopes/kota",
          pid: 12345,
          startedAt: "2026-04-29T01:00:00.000Z",
          capabilities: {
            capabilities: [
              {
                id: DASHBOARD_CAPABILITY_ID,
                moduleName: "web",
                status: "unavailable",
                reason: "web_ui_not_built",
                message: "Run pnpm --filter @kota/web build.",
              },
            ],
            summary: { ready: 0, unavailable: 1, init_failed: 0 },
          },
          scopeRegistry: stubScopes,
        }),
      ),
    });
    const otherServer = new DaemonControlServer(handle, TEST_TOKEN);
    const otherPort = await otherServer.start();
    try {
      const res = await fetch(`http://127.0.0.1:${otherPort}/identity`, {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.dashboard).toEqual({
        available: false,
        reason: "web_ui_not_built",
        message: "Run pnpm --filter @kota/web build.",
      });
    } finally {
      await otherServer.stop();
    }
  });
});
