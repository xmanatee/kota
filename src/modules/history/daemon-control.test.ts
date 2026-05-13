/**
 * Exercises the history module's daemon-control routes through the same
 * registration seam the real daemon uses: `historyControlRoutes()` is the
 * module's contribution, so the test mounts those handlers on a live
 * `DaemonControlServer` and hits `/history`, `/history/:id` via HTTP.
 *
 * Covers the wire contract migrated out of core: bearer-token auth, the
 * `read` / `control` capability-scope split (the two GETs are read-only,
 * DELETE requires control), `{ conversations: ... }` envelope on list,
 * 404 for missing conversation, 204 on delete.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DaemonControlHandle,
  DaemonControlServer,
  type WorkflowMetricCounts,
} from "#core/daemon/daemon-control.js";
import { buildConfiguredProject } from "#core/daemon/project-registry.js";
import {
  HISTORY_PROVIDER_TOKEN,
  initProviderRegistry,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { getHistory, resetHistory } from "./history.js";
import { HistoryProjectStores } from "./project-scope.js";
import { historyControlRoutes } from "./routes.js";

const TEST_TOKEN = "history-test-token";

function makeHandle(): DaemonControlHandle {
  return {
    getDaemonLiveState: vi.fn(() => ({
      startedAt: "2026-01-01T00:00:00.000Z",
      completedRuns: 0,
      pid: 1,
      running: true,
    })),
    getHealthStatus: vi.fn(() => ({ scheduler: "ok" as const, modules: "ok" as const })),
    getWorkflowLiveStatus: vi.fn(() => ({
      activeRuns: [],
      pendingRuns: [],
      queueLength: 0,
      completedRuns: 0,
      workflows: {},
      paused: false,
      agentConcurrency: 1,
      codeConcurrency: 4,
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
    getWorkflowMetricCounts: vi.fn((): WorkflowMetricCounts => ({ runCounts: [], costTotals: [], durationHistogram: [] })),
    registerSession: vi.fn(),
    unregisterSession: vi.fn(),
    listSessions: vi.fn(() => []),
    setSessionAutonomyMode: vi.fn(() => ({ ok: false, notFound: true })),
    getProjectRegistryProjection: vi.fn(() => ({ defaultProjectId: "test-project-id", projects: [{ projectId: "test-project-id", projectDir: "/tmp/test-project", displayName: "test-project" }] })),
    hasProject: vi.fn((id: string) => id === "test-project-id"),
    getActiveProjectId: vi.fn(() => null),
    setActiveProjectId: vi.fn((id: string | null) => (id === null ? { ok: true as const, activeProjectId: null } : id === "test-project-id" ? { ok: true as const, activeProjectId: id } : { ok: false as const, reason: "not_found" as const, projectId: id })),
    reloadConfig: vi.fn(async () => ({ workflows: 0, changedModules: [] })),
    probeCapabilityReadiness: vi.fn(async () => ({ capabilities: [], summary: { ready: 0, unavailable: 0, init_failed: 0 } })),
    getClientIdentity: vi.fn(async () => ({
      projectName: "test-project",
      projectDir: "/tmp/test-project",
      projects: { defaultProjectId: "test-project-id", projects: [{ projectId: "test-project-id", projectDir: "/tmp/test-project", displayName: "test-project" }] },
      daemonVersion: "0.1.0",
      pid: 9999,
      startedAt: "2026-01-01T00:00:00.000Z",
      dashboard: {
        available: false as const,
        reason: "not_contributed",
        message: "No module contributed a dashboard capability.",
      },
    })),
  };
}

async function fetchWith(
  port: number,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return globalThis.fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TEST_TOKEN}`, ...init.headers },
  });
}

describe("history module daemon-control routes", () => {
  let server: DaemonControlServer;
  let port: number;
  let homeDir: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    homeDir = mkdtempSync(join(tmpdir(), "kota-history-control-"));
    prevHome = process.env.HOME;
    process.env.HOME = homeDir;
    resetHistory();
    initProviderRegistry().register(HISTORY_PROVIDER_TOKEN, "default", getHistory());
    server = new DaemonControlServer(makeHandle(), TEST_TOKEN, {
      controlRoutes: historyControlRoutes(),
    });
    port = await server.start();
  });

  afterEach(async () => {
    await server.stop();
    resetProviderRegistry();
    resetHistory();
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(homeDir, { recursive: true, force: true });
  });

  describe("registration seam", () => {
    it("declares /history routes with read/control capability scopes", () => {
      const routes = historyControlRoutes();
      expect(routes.map((r) => `${r.method} ${r.path} (${r.capabilityScope})`)).toEqual([
        "GET /history (read)",
        "POST /history/reindex (control)",
        "GET /history/:id (read)",
        "DELETE /history/:id (control)",
      ]);
    });

    it("requires the daemon bearer token on all three routes", async () => {
      for (const init of [
        { path: "/history", method: "GET" },
        { path: "/history/anything", method: "GET" },
        { path: "/history/anything", method: "DELETE" },
      ]) {
        const res = await globalThis.fetch(`http://127.0.0.1:${port}${init.path}`, {
          method: init.method,
        });
        expect(res.status).toBe(401);
      }
    });
  });

  describe("GET /history", () => {
    it("returns 200 with empty conversations list when none exist", async () => {
      const res = await fetchWith(port, "/history");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ conversations: [] });
    });

    it("returns conversations created via the history provider", async () => {
      const { getHistory } = await import("./history.js");
      const id = getHistory().create("claude-sonnet-4-6", "/tmp/project");

      const res = await fetchWith(port, "/history");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { conversations: Array<{ id: string }> };
      expect(body.conversations).toHaveLength(1);
      expect(body.conversations[0].id).toBe(id);
    });

    it("respects search and limit query params", async () => {
      const { getHistory } = await import("./history.js");
      const history = getHistory();
      const id1 = history.create("claude-sonnet-4-6", "/tmp/p1");
      history.save(id1, [{ role: "user", content: "alpha discussion" }], 0, 0);
      const id2 = history.create("claude-sonnet-4-6", "/tmp/p2");
      history.save(id2, [{ role: "user", content: "beta discussion" }], 0, 0);

      const filtered = await fetchWith(port, "/history?search=alpha");
      expect(filtered.status).toBe(200);
      const filteredBody = (await filtered.json()) as { conversations: Array<{ id: string }> };
      expect(filteredBody.conversations.map((c) => c.id)).toEqual([id1]);

      const limited = await fetchWith(port, "/history?limit=1");
      const limitedBody = (await limited.json()) as { conversations: unknown[] };
      expect(limitedBody.conversations).toHaveLength(1);
    });

    it("resolves projectId through the project store boundary", async () => {
      const root = mkdtempSync(join(tmpdir(), "kota-history-control-projects-"));
      const projectA = buildConfiguredProject({ projectDir: join(root, "a") });
      const projectB = buildConfiguredProject({ projectDir: join(root, "b") });
      const stores = new HistoryProjectStores({
        defaultProjectDir: projectA.projectDir,
        defaultProjectId: projectA.projectId,
        projects: [projectA, projectB],
      });
      const scopedServer = new DaemonControlServer(makeHandle(), TEST_TOKEN, {
        controlRoutes: historyControlRoutes(stores),
      });
      const scopedPort = await scopedServer.start();
      try {
        const scopedA = stores.resolve(projectA.projectId);
        if (!scopedA.ok) throw new Error("project A did not resolve");
        const id = scopedA.store.create(
          "claude-sonnet-4-6",
          projectA.projectDir,
        );

        const a = await fetchWith(
          scopedPort,
          `/history?projectId=${projectA.projectId}`,
        );
        expect(a.status).toBe(200);
        const aBody = (await a.json()) as { conversations: Array<{ id: string }> };
        expect(aBody.conversations.map((conversation) => conversation.id)).toEqual([id]);

        const b = await fetchWith(
          scopedPort,
          `/history?projectId=${projectB.projectId}`,
        );
        expect(b.status).toBe(200);
        const bBody = (await b.json()) as { conversations: unknown[] };
        expect(bBody.conversations).toEqual([]);

        const unknown = await fetchWith(scopedPort, "/history?projectId=ghost");
        expect(unknown.status).toBe(404);
        expect(await unknown.json()).toEqual({
          error: "Unknown project",
          reason: "unknown_project",
          projectId: "ghost",
        });
      } finally {
        await scopedServer.stop();
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe("GET /history/:id", () => {
    it("returns 200 with full conversation data when found", async () => {
      const { getHistory } = await import("./history.js");
      const history = getHistory();
      const id = history.create("claude-sonnet-4-6", "/tmp/project");
      history.save(id, [{ role: "user", content: "hello" }], 0, 42);

      const res = await fetchWith(port, `/history/${id}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { record: { id: string }; lastInputTokens: number };
      expect(body.record.id).toBe(id);
      expect(body.lastInputTokens).toBe(42);
    });

    it("returns 404 when conversation is missing", async () => {
      const res = await fetchWith(port, "/history/missing-id");
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBeTruthy();
    });
  });

  describe("POST /history/reindex", () => {
    it("returns the provider's ReindexResult — base provider reports skipped", async () => {
      const res = await fetchWith(port, "/history/reindex", { method: "POST" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { indexed: number; failed: number; skipped?: boolean };
      expect(body).toEqual({ indexed: 0, failed: 0, skipped: true });
    });

    it("requires the daemon bearer token", async () => {
      const res = await globalThis.fetch(`http://127.0.0.1:${port}/history/reindex`, {
        method: "POST",
      });
      expect(res.status).toBe(401);
    });
  });

  describe("DELETE /history/:id", () => {
    it("returns 200 with { deleted: id } and removes the conversation", async () => {
      const { getHistory } = await import("./history.js");
      const history = getHistory();
      const id = history.create("claude-sonnet-4-6", "/tmp/project");

      const res = await fetchWith(port, `/history/${id}`, { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ deleted: id });
      expect(history.load(id)).toBeNull();
    });

    it("returns 404 when conversation does not exist", async () => {
      const res = await fetchWith(port, "/history/never-existed", { method: "DELETE" });
      expect(res.status).toBe(404);
    });
  });

  describe("collision detection", () => {
    it("throws at server construction if two contributions claim the same route key", async () => {
      const collision = [
        ...historyControlRoutes(),
        {
          method: "GET" as const,
          path: "/history",
          capabilityScope: "read" as const,
          handler: (_req: unknown, res: { writeHead: (s: number) => void; end: () => void }) => {
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
