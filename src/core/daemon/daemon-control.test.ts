import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DaemonControlHandle,
  DaemonControlServer,
  type DaemonSseEvent,
  type WorkflowLiveStatus,
  type WorkflowMetricCounts,
} from "./daemon-control.js";
import {
  makeDaemonConfigReloadEvent,
  makeTaskChangedEvent,
  makeWorkflowCompletedEvent,
  makeWorkflowStartedEvent,
} from "./sse-event-fixtures.integration.js";

const TEST_TOKEN = "test-secret-token-abc123";

function makeHandle(overrides: Partial<DaemonControlHandle> = {}): DaemonControlHandle {
  const defaultWorkflowStatus: WorkflowLiveStatus = {
    activeRuns: [],
    pendingRuns: [],
    queueLength: 0,
    completedRuns: 0,
    workflows: {},
    paused: false,
    agentConcurrency: 1,
    codeConcurrency: 4,
  };
  return {
    getDaemonLiveState: vi.fn(() => ({
      startedAt: "2026-01-01T00:00:00.000Z",
      completedRuns: 0,
      pid: 9999,
      running: true,
    })),
    getHealthStatus: vi.fn(() => ({ scheduler: "ok" as const, modules: "ok" as const })),
    getWorkflowLiveStatus: vi.fn(() => ({ ...defaultWorkflowStatus })),
    listChannelStatuses: vi.fn(() => []),
    pauseWorkflowDispatch: vi.fn(() => ({ already: false })),
    resumeWorkflowDispatch: vi.fn(() => ({ already: false })),
    abortActiveRuns: vi.fn(() => ({ aborted: 0 })),
    abortActiveRun: vi.fn(() => ({ ok: false, notFound: true })),
    reloadWorkflowDefinitions: vi.fn(() => ({ count: 3 })),
    getWorkflowDefinitions: vi.fn(() => []),
    enableWorkflow: vi.fn(() => ({ ok: true })),
    disableWorkflow: vi.fn(() => ({ ok: true })),
    enqueuePendingRun: vi.fn(() => ({ ok: true, queued: "builder", runId: "2026-01-01T00-00-00-000Z-builder-abc123" })),
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
    reloadConfig: vi.fn(async () => ({ workflows: 3, changedModules: [] as string[], sessionGuardrails: { refreshed: 0, unchanged: 0, nonRefreshable: [] } })),
    probeCapabilityReadiness: vi.fn(async () => ({
      capabilities: [],
      summary: { ready: 0, unavailable: 0, init_failed: 0 },
    })),
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
    ...overrides,
  };
}

async function fetchWithToken(port: number, path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${TEST_TOKEN}`);
  return globalThis.fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers });
}

async function fetchNoToken(port: number, path: string, options: RequestInit = {}): Promise<Response> {
  return globalThis.fetch(`http://127.0.0.1:${port}${path}`, options);
}

describe("DaemonControlServer", () => {
  let server: DaemonControlServer;
  let handle: DaemonControlHandle;
  let port: number;

  beforeEach(async () => {
    handle = makeHandle();
    server = new DaemonControlServer(handle, TEST_TOKEN);
    port = await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  describe("auth", () => {
    it("returns 401 when token is missing", async () => {
      const res = await fetchNoToken(port, "/status");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it("returns 401 when token is wrong", async () => {
      const res = await globalThis.fetch(`http://127.0.0.1:${port}/status`, {
        headers: { Authorization: "Bearer wrong-token" },
      });
      expect(res.status).toBe(401);
    });

    it("accepts correct token", async () => {
      const res = await fetchWithToken(port, "/status");
      expect(res.status).toBe(200);
    });

    it("requires token on control routes", async () => {
      const controlRoutes = [
        { path: "/workflow/pause", method: "POST" },
        { path: "/workflow/resume", method: "POST" },
        { path: "/workflow/abort", method: "POST" },
        { path: "/workflow/reload", method: "POST" },
        { path: "/reload", method: "POST" },
      ];
      for (const { path, method } of controlRoutes) {
        const res = await fetchNoToken(port, path, { method });
        expect(res.status).toBe(401);
      }
    });

    it("lets matched module routes shape auth failures", async () => {
      const handler = vi.fn();
      const shapedServer = new DaemonControlServer(makeHandle(), TEST_TOKEN, {
        routes: [
          {
            method: "POST",
            path: "/api/custom",
            authFailureHandler: (_req, res) => {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: { data: [{ reason: "CUSTOM_AUTH" }] } }));
            },
            handler,
          },
        ],
      });
      const shapedPort = await shapedServer.start();
      try {
        const res = await fetchNoToken(shapedPort, "/api/custom", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ error: { data: [{ reason: "CUSTOM_AUTH" }] } });
        expect(handler).not.toHaveBeenCalled();
      } finally {
        await shapedServer.stop();
      }
    });

    it("does not require token when server has no token configured", async () => {
      const unprotected = new DaemonControlServer(makeHandle());
      const unprotectedPort = await unprotected.start();
      try {
        const res = await fetchNoToken(unprotectedPort, "/status");
        expect(res.status).toBe(200);
      } finally {
        await unprotected.stop();
      }
    });
  });

  describe("GET /status", () => {
    it("returns 200 with daemon and workflow state", async () => {
      const res = await fetchWithToken(port, "/status");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        startedAt: "2026-01-01T00:00:00.000Z",
        pid: 9999,
        running: true,
        workflow: {
          activeRuns: [],
          pendingRuns: [],
          completedRuns: 0,
          paused: false,
        },
      });
      expect(body.channels).toEqual([]);
    });

    it("includes the channel posture array from the handle", async () => {
      handle = makeHandle({
        listChannelStatuses: vi.fn(() => [
          { name: "alpha", status: "started" as const },
          { name: "beta", status: "disabled" as const, reason: "off-by-config" },
        ]),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/status");
      const body = await res.json();
      expect(body.channels).toEqual([
        { name: "alpha", status: "started" },
        { name: "beta", status: "disabled", reason: "off-by-config" },
      ]);
    });
  });

  describe("GET /projects", () => {
    it("returns the typed project registry projection plus active selection", async () => {
      const res = await fetchWithToken(port, "/projects");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        defaultProjectId: "test-project-id",
        activeProjectId: null,
        projects: [
          {
            projectId: "test-project-id",
            projectDir: "/tmp/test-project",
            displayName: "test-project",
          },
        ],
      });
    });
  });

  describe("active project selection", () => {
    it("GET /projects/active returns the current active project (null by default)", async () => {
      const res = await fetchWithToken(port, "/projects/active");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ activeProjectId: null });
    });

    it("PATCH /projects/active sets the active project and routes a subsequent omitted-projectId request to it", async () => {
      const patchRes = await fetchWithToken(port, "/projects/active", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "test-project-id" }),
      });
      expect(patchRes.status).toBe(200);
      expect(await patchRes.json()).toEqual({ activeProjectId: "test-project-id" });
      expect(handle.setActiveProjectId).toHaveBeenCalledWith("test-project-id");

      const lookup = handle.getWorkflowLiveStatus as ReturnType<typeof vi.fn>;
      lookup.mockClear();
      handle.getActiveProjectId = vi.fn(() => "test-project-id");
      await fetchWithToken(port, "/workflow/status");
      expect(lookup).toHaveBeenCalledWith("test-project-id");
    });

    it("PATCH /projects/active with null clears the selection", async () => {
      const res = await fetchWithToken(port, "/projects/active", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: null }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ activeProjectId: null });
      expect(handle.setActiveProjectId).toHaveBeenCalledWith(null);
    });

    it("PATCH /projects/active rejects unknown ids with the typed 404 shape", async () => {
      const res = await fetchWithToken(port, "/projects/active", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "ghost" }),
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        error: "Unknown project",
        reason: "unknown_project",
        projectId: "ghost",
      });
    });

    it("PATCH /projects/active rejects malformed request bodies", async () => {
      const res = await fetchWithToken(port, "/projects/active", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: 42 }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.reason).toBe("invalid_request");
    });

    it("omitted ?projectId= falls back to the registry default when no active selection is set", async () => {
      handle.getActiveProjectId = vi.fn(() => null);
      const lookup = handle.getWorkflowLiveStatus as ReturnType<typeof vi.fn>;
      lookup.mockClear();
      await fetchWithToken(port, "/workflow/status");
      expect(lookup).toHaveBeenCalledWith(undefined);
    });
  });

  describe("project-scoped route validation", () => {
    it("returns 404 with the typed unknown_project shape when ?projectId= names an unconfigured project", async () => {
      const res = await fetchWithToken(
        port,
        "/workflow/status?projectId=p-not-configured",
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toEqual({
        error: "Unknown project",
        reason: "unknown_project",
        projectId: "p-not-configured",
      });
    });

    it("forwards a configured projectId through to the handle", async () => {
      const res = await fetchWithToken(
        port,
        "/workflow/status?projectId=test-project-id",
      );
      expect(res.status).toBe(200);
      expect(handle.getWorkflowLiveStatus).toHaveBeenCalledWith(
        "test-project-id",
      );
    });
  });

  describe("GET /channels", () => {
    it("returns the channel posture from the handle", async () => {
      handle = makeHandle({
        listChannelStatuses: vi.fn(() => [
          {
            name: "telegram-status",
            status: "unavailable" as const,
            reason: "no creds",
          },
          {
            name: "webhook-channel",
            description: "Generic inbound HTTP webhook",
            status: "started" as const,
          },
        ]),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/channels");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.channels).toEqual([
        { name: "telegram-status", status: "unavailable", reason: "no creds" },
        {
          name: "webhook-channel",
          description: "Generic inbound HTTP webhook",
          status: "started",
        },
      ]);
    });

    it("requires the bearer token", async () => {
      const res = await fetchNoToken(port, "/channels");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /capabilities", () => {
    it("returns 200 with the readiness response from the handle", async () => {
      handle = makeHandle({
        probeCapabilityReadiness: vi.fn(async () => ({
          capabilities: [
            { id: "knowledge.search", moduleName: "knowledge", status: "ready" as const },
            {
              id: "knowledge.semantic_search",
              moduleName: "knowledge",
              status: "unavailable" as const,
              reason: "embedding_unsupported",
              message: "Semantic search is unavailable.",
            },
          ],
          summary: { ready: 1, unavailable: 1, init_failed: 0 },
        })),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/capabilities");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.summary).toEqual({ ready: 1, unavailable: 1, init_failed: 0 });
      expect(body.capabilities).toHaveLength(2);
      expect(body.capabilities[1]).toMatchObject({
        id: "knowledge.semantic_search",
        status: "unavailable",
        reason: "embedding_unsupported",
      });
    });

    it("requires the bearer token", async () => {
      const res = await fetchNoToken(port, "/capabilities");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /workflow/status", () => {
    it("returns 200 with workflow live status", async () => {
      const res = await fetchWithToken(port, "/workflow/status");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        activeRuns: [],
        pendingRuns: [],
        queueLength: 0,
        paused: false,
      });
    });

    it("reflects paused state from handle", async () => {
      handle = makeHandle({
        getWorkflowLiveStatus: vi.fn(() => ({
          activeRuns: [],
          pendingRuns: [],
          queueLength: 0,
          completedRuns: 1,
          workflows: {},
          paused: true,
          agentConcurrency: 1,
          codeConcurrency: 4,
        })),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/workflow/status");
      const body = await res.json();
      expect(body.paused).toBe(true);
    });
  });

  describe("POST /workflow/trigger", () => {
    it("enqueues a valid workflow and returns 200", async () => {
      const res = await fetchWithToken(port, "/workflow/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "builder" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, queued: "builder", runId: "2026-01-01T00-00-00-000Z-builder-abc123" });
      expect(handle.enqueuePendingRun).toHaveBeenCalledWith("builder", undefined, undefined, undefined);
    });

    it("returns 400 for invalid JSON body", async () => {
      const res = await fetchWithToken(port, "/workflow/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it("returns 400 when name is missing", async () => {
      const res = await fetchWithToken(port, "/workflow/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when name contains invalid characters", async () => {
      const res = await fetchWithToken(port, "/workflow/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "bad name!" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 409 when workflow is already queued", async () => {
      handle = makeHandle({
        enqueuePendingRun: vi.fn(() => ({ ok: false, alreadyQueued: true })),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/workflow/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "builder" }),
      });
      expect(res.status).toBe(409);
    });

    it("returns 400 when enqueue fails with an error message", async () => {
      handle = makeHandle({
        enqueuePendingRun: vi.fn(() => ({ ok: false, error: "No such workflow" })),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/workflow/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "unknown" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("No such workflow");
    });
  });

  describe("POST /workflow/pause", () => {
    it("pauses dispatch and returns ok", async () => {
      const res = await fetchWithToken(port, "/workflow/pause", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, paused: true });
      expect(body.already).toBeUndefined();
    });

    it("includes already:true when already paused", async () => {
      handle = makeHandle({ pauseWorkflowDispatch: vi.fn(() => ({ already: true })) });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/workflow/pause", { method: "POST" });
      const body = await res.json();
      expect(body.already).toBe(true);
    });
  });

  describe("POST /workflow/resume", () => {
    it("resumes dispatch and returns ok", async () => {
      const res = await fetchWithToken(port, "/workflow/resume", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, paused: false });
      expect(body.already).toBeUndefined();
    });

    it("includes already:true when already running", async () => {
      handle = makeHandle({ resumeWorkflowDispatch: vi.fn(() => ({ already: true })) });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/workflow/resume", { method: "POST" });
      const body = await res.json();
      expect(body.already).toBe(true);
    });
  });

  describe("POST /workflow/abort", () => {
    it("aborts active runs and returns count", async () => {
      handle = makeHandle({ abortActiveRuns: vi.fn(() => ({ aborted: 2 })) });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/workflow/abort", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, aborted: 2 });
    });
  });

  describe("POST /workflow/reload", () => {
    it("reloads definitions and returns count", async () => {
      const res = await fetchWithToken(port, "/workflow/reload", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, count: 3 });
    });
  });

  describe("POST /reload", () => {
    it("reloads config and returns workflow count", async () => {
      const res = await fetchWithToken(port, "/reload", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        ok: true,
        workflows: 3,
        changedModules: [],
        sessionGuardrails: { refreshed: 0, unchanged: 0, nonRefreshable: [] },
      });
    });

    it("exposes successful reload events through event catch-up and SSE", async () => {
      let eventHandler: ((e: DaemonSseEvent) => void) | null = null;
      handle = makeHandle({
        subscribeToEvents: vi.fn((h) => {
          eventHandler = h;
          return () => { eventHandler = null; };
        }),
        reloadConfig: vi.fn(async () => {
          eventHandler!(makeDaemonConfigReloadEvent({
            changedModules: ["tracing"],
            workflowCount: 4,
          }));
          return {
            workflows: 4,
            changedModules: ["tracing"],
            sessionGuardrails: { refreshed: 0, unchanged: 0, nonRefreshable: [] },
          };
        }),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const beforeReload = new Date(Date.now() - 1000).toISOString();
      const reloadRes = await fetchWithToken(port, "/reload", { method: "POST" });
      expect(reloadRes.status).toBe(200);

      const apiRes = await fetchWithToken(port, "/api/events?type=daemon.config.reload");
      const apiBody = await apiRes.json();
      expect(apiBody.events).toHaveLength(1);
      expect(apiBody.events[0]).toMatchObject({
        type: "daemon.config.reload",
        payload: {
          outcome: "success",
          reloadKind: "module-scoped",
          changedModules: ["tracing"],
          workflowCount: 4,
          scope: "daemon",
        },
      });

      const controller = new AbortController();
      const sseRes = await fetchWithToken(
        port,
        `/events?since=${encodeURIComponent(beforeReload)}`,
        { signal: controller.signal },
      );
      expect(sseRes.status).toBe(200);
      const reader = sseRes.body!.getReader();
      const decoder = new TextDecoder();
      let received = "";
      while (!received.includes("daemon.config.reload")) {
        const { done, value } = await reader.read();
        if (done) break;
        received += decoder.decode(value);
      }
      controller.abort();

      expect(received).toContain("event: daemon.config.reload");
      expect(received).toContain('"changedModules":["tracing"]');
    });

    it("exposes failed reload events without raw config values", async () => {
      let eventHandler: ((e: DaemonSseEvent) => void) | null = null;
      handle = makeHandle({
        subscribeToEvents: vi.fn((h) => {
          eventHandler = h;
          return () => { eventHandler = null; };
        }),
        reloadConfig: vi.fn(async () => {
          eventHandler!({
            type: "daemon.config.reload",
            payload: {
              timestamp: "2026-01-01T00:00:00.000Z",
              scope: "daemon",
              outcome: "failure",
              reloadKind: "failed",
              fullReload: false,
              changedModules: [],
              workflowCount: 3,
              errorClass: "Error",
              errorMessage: "Config reload failed",
            },
          });
          throw new Error("raw config secret");
        }),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const reloadRes = await fetchWithToken(port, "/reload", { method: "POST" });
      expect(reloadRes.status).toBe(500);

      const apiRes = await fetchWithToken(port, "/api/events?type=daemon.config.reload");
      const apiBody = await apiRes.json();
      expect(apiBody.events).toHaveLength(1);
      expect(apiBody.events[0].payload).toMatchObject({
        outcome: "failure",
        errorClass: "Error",
        errorMessage: "Config reload failed",
      });
      expect(JSON.stringify(apiBody.events[0].payload)).not.toContain("raw config secret");
    });

    it("requires authentication", async () => {
      const res = await fetchNoToken(port, "/reload", { method: "POST" });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /workflow/definitions", () => {
    it("returns 200 with definitions list", async () => {
      handle = makeHandle({
        getWorkflowDefinitions: vi.fn(() => [
          {
            name: "builder",
            enabled: true,
            stepCount: 3,
            triggers: [{ type: "event" as const, event: "runtime.idle" }],
          },
        ]),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/workflow/definitions");
      expect(res.status).toBe(200);
      const body = await res.json() as { definitions: unknown[] };
      expect(body.definitions).toHaveLength(1);
      expect(body.definitions[0]).toMatchObject({
        name: "builder",
        enabled: true,
        stepCount: 3,
        triggers: [{ type: "event", event: "runtime.idle" }],
      });
    });

    it("includes watch trigger metadata in definitions", async () => {
      handle = makeHandle({
        getWorkflowDefinitions: vi.fn(() => [
          {
            name: "file-watcher",
            enabled: true,
            stepCount: 1,
            triggers: [{ type: "watch" as const, patterns: ["src/**/*.ts", "tests/**/*.ts"], debounceMs: 300 }],
          },
        ]),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/workflow/definitions");
      expect(res.status).toBe(200);
      const body = await res.json() as { definitions: unknown[] };
      expect(body.definitions[0]).toMatchObject({
        name: "file-watcher",
        triggers: [{ type: "watch", patterns: ["src/**/*.ts", "tests/**/*.ts"], debounceMs: 300 }],
      });
    });

    it("requires auth", async () => {
      const res = await fetchNoToken(port, "/workflow/definitions");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /workflow/definitions/:name/disable", () => {
    it("calls handle.disableWorkflow and returns ok", async () => {
      handle = makeHandle({
        disableWorkflow: vi.fn(() => ({ ok: true })),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/workflow/definitions/builder/disable", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.ok).toBe(true);
      expect(body.runtimeEnabled).toBe(false);
      expect(handle.disableWorkflow).toHaveBeenCalledWith("builder", undefined);
    });

    it("returns 404 when workflow not found", async () => {
      handle = makeHandle({
        disableWorkflow: vi.fn(() => ({ ok: false, notFound: true })),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/workflow/definitions/unknown/disable", { method: "POST" });
      expect(res.status).toBe(404);
    });

    it("requires auth", async () => {
      const res = await fetchNoToken(port, "/workflow/definitions/builder/disable", { method: "POST" });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /workflow/definitions/:name/enable", () => {
    it("calls handle.enableWorkflow and returns ok", async () => {
      handle = makeHandle({
        enableWorkflow: vi.fn(() => ({ ok: true })),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/workflow/definitions/builder/enable", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.ok).toBe(true);
      expect(body.runtimeEnabled).toBe(true);
      expect(handle.enableWorkflow).toHaveBeenCalledWith("builder", undefined);
    });

    it("returns 404 when workflow not found", async () => {
      handle = makeHandle({
        enableWorkflow: vi.fn(() => ({ ok: false, notFound: true })),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/workflow/definitions/unknown/enable", { method: "POST" });
      expect(res.status).toBe(404);
    });

    it("requires auth", async () => {
      const res = await fetchNoToken(port, "/workflow/definitions/builder/enable", { method: "POST" });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /events", () => {
    it("returns 200 with SSE content-type and keeps connection open", async () => {
      const controller = new AbortController();
      const res = await fetchWithToken(port, "/events", { signal: controller.signal });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      controller.abort();
    });

    it("delivers events to connected clients", async () => {
      let eventHandler: ((e: DaemonSseEvent) => void) | null = null;
      handle = makeHandle({
        subscribeToEvents: vi.fn((h) => {
          eventHandler = h;
          return () => { eventHandler = null; };
        }),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const controller = new AbortController();
      const res = await fetchWithToken(port, "/events", { signal: controller.signal });
      expect(res.status).toBe(200);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      // Emit an event after connection is established
      eventHandler!(makeWorkflowStartedEvent({ workflow: "builder", runId: "run-1" }));

      // Read chunks until we have the event
      let received = "";
      while (!received.includes("workflow.started")) {
        const { done, value } = await reader.read();
        if (done) break;
        received += decoder.decode(value);
      }

      expect(received).toContain("event: workflow.started");
      expect(received).toContain("id: evt-1");
      expect(received).toContain('"workflow":"builder"');
      controller.abort();
    });
  });

  describe("GET /workflow/runs", () => {
    it("returns 200 with empty runs list", async () => {
      const res = await fetchWithToken(port, "/workflow/runs");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ runs: [] });
      expect(handle.listWorkflowRuns).toHaveBeenCalled();
    });

    it("returns runs from handle", async () => {
      const run = { id: "run-1", workflow: "builder", status: "success", triggerEvent: "runtime.idle", startedAt: "2026-01-01T00:00:00.000Z" };
      handle = makeHandle({ listWorkflowRuns: vi.fn(() => [run]) });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/workflow/runs");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.runs).toHaveLength(1);
      expect(body.runs[0].id).toBe("run-1");
    });

    it("passes workflow filter and limit to handle", async () => {
      const res = await fetchWithToken(port, "/workflow/runs?workflow=builder&limit=5");
      expect(res.status).toBe(200);
      expect(handle.listWorkflowRuns).toHaveBeenCalledWith({ workflow: "builder", limit: 5, tag: undefined, causedByRunId: undefined, projectId: undefined });
    });

    it("passes tag filter to handle", async () => {
      const res = await fetchWithToken(port, "/workflow/runs?tag=my-tag");
      expect(res.status).toBe(200);
      expect(handle.listWorkflowRuns).toHaveBeenCalledWith({ workflow: undefined, limit: 20, tag: "my-tag", causedByRunId: undefined, projectId: undefined });
    });

    it("passes causedByRunId filter to handle", async () => {
      const res = await fetchWithToken(port, "/workflow/runs?causedByRunId=upstream-run-id");
      expect(res.status).toBe(200);
      expect(handle.listWorkflowRuns).toHaveBeenCalledWith({ workflow: undefined, limit: 20, tag: undefined, causedByRunId: "upstream-run-id", projectId: undefined });
    });

    it("returns 401 without token", async () => {
      const res = await fetchNoToken(port, "/workflow/runs");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /workflow/runs/:id", () => {
    it("returns 200 with run detail when found", async () => {
      const run = { id: "run-1", workflow: "builder", status: "success", triggerEvent: "runtime.idle", startedAt: "2026-01-01T00:00:00.000Z", steps: [] };
      handle = makeHandle({ getWorkflowRun: vi.fn(() => run) });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/workflow/runs/run-1");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe("run-1");
      expect(handle.getWorkflowRun).toHaveBeenCalledWith("run-1", undefined);
    });

    it("returns 404 when run not found", async () => {
      const res = await fetchWithToken(port, "/workflow/runs/missing-run");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it("returns 401 without token", async () => {
      const res = await fetchNoToken(port, "/workflow/runs/run-1");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /health", () => {
    it("returns 200 with ok status when all components are healthy", async () => {
      const res = await fetchNoToken(port, "/health");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        status: "ok",
        version: "0.1.0",
        components: { scheduler: "ok", modules: "ok" },
      });
      expect(typeof body.uptimeMs).toBe("number");
    });

    it("does not require auth token", async () => {
      const res = await fetchNoToken(port, "/health");
      expect(res.status).toBe(200);
    });

    it("returns 503 with degraded status when scheduler reports error", async () => {
      handle = makeHandle({
        getHealthStatus: vi.fn(() => ({ scheduler: "error" as const, modules: "ok" as const })),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchNoToken(port, "/health");
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body).toMatchObject({
        status: "degraded",
        components: { scheduler: "error", modules: "ok" },
      });
    });

    it("returns 503 with degraded status when modules report error", async () => {
      handle = makeHandle({
        getHealthStatus: vi.fn(() => ({ scheduler: "ok" as const, modules: "error" as const })),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchNoToken(port, "/health");
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.status).toBe("degraded");
    });

    it("includes moduleHealthChecks in response when present", async () => {
      handle = makeHandle({
        getHealthStatus: vi.fn(() => ({
          scheduler: "ok" as const,
          modules: "ok" as const,
          moduleHealthChecks: {
            "sqlite-memory": { status: "healthy" as const },
            "webhook": { status: "degraded" as const, message: "endpoint unreachable" },
          },
        })),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchNoToken(port, "/health");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.components.moduleHealthChecks).toEqual({
        "sqlite-memory": { status: "healthy" },
        "webhook": { status: "degraded", message: "endpoint unreachable" },
      });
    });
  });

  describe("DELETE /workflow/runs/:id", () => {
    it("returns 200 when run is successfully cancelled", async () => {
      handle = makeHandle({ cancelQueuedRun: vi.fn(() => ({ ok: true })) });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/workflow/runs/2026-01-01T00-00-00-000Z-builder-abc123", { method: "DELETE" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true });
      expect(handle.cancelQueuedRun).toHaveBeenCalledWith("2026-01-01T00-00-00-000Z-builder-abc123", undefined);
    });

    it("returns 404 when run is not found", async () => {
      const res = await fetchWithToken(port, "/workflow/runs/unknown-run-id", { method: "DELETE" });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it("returns 409 when run is active", async () => {
      handle = makeHandle({ cancelQueuedRun: vi.fn(() => ({ ok: false, active: true })) });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/workflow/runs/some-active-run-id", { method: "DELETE" });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it("requires auth", async () => {
      const res = await fetchNoToken(port, "/workflow/runs/some-run-id", { method: "DELETE" });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /workflow/runs/:id/abort", () => {
    it("aborts an active run and returns 200", async () => {
      handle = makeHandle({ abortActiveRun: vi.fn(() => ({ ok: true })) });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/workflow/runs/2026-01-01T00-00-00-000Z-builder-abc123/abort", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true });
      expect(handle.abortActiveRun).toHaveBeenCalledWith("2026-01-01T00-00-00-000Z-builder-abc123", undefined);
    });

    it("returns 404 for unknown run ID", async () => {
      const res = await fetchWithToken(port, "/workflow/runs/unknown-run-id/abort", { method: "POST" });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it("returns 409 when run is queued not active", async () => {
      handle = makeHandle({ abortActiveRun: vi.fn(() => ({ ok: false, queued: true })) });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/workflow/runs/queued-run-id/abort", { method: "POST" });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it("requires auth", async () => {
      const res = await fetchNoToken(port, "/workflow/runs/some-run-id/abort", { method: "POST" });
      expect(res.status).toBe(401);
    });
  });

  describe("unknown routes", () => {
    it("returns 404 for an unrecognized path", async () => {
      const res = await fetchWithToken(port, "/does-not-exist");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it("returns 404 for wrong method on known path", async () => {
      const res = await fetchWithToken(port, "/status", { method: "POST" });
      expect(res.status).toBe(404);
    });
  });

  describe("route handler errors", () => {
    it("converts synchronous route handler throws into 500 responses", async () => {
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN, {
        controlRoutes: [
          {
            method: "GET",
            path: "/throws-sync",
            capabilityScope: "read",
            handler: () => {
              throw new Error("sync route failure");
            },
          },
        ],
      });
      port = await server.start();

      const res = await fetchWithToken(port, "/throws-sync");
      expect(res.status).toBe(500);
      await expect(res.json()).resolves.toEqual({ error: "sync route failure" });
    });
  });

  describe("GET /api/events", () => {
    function pushEvents(h: DaemonControlHandle): (event: DaemonSseEvent) => void {
      const calls = (h.subscribeToEvents as ReturnType<typeof vi.fn>).mock.calls;
      return calls[calls.length - 1][0];
    }

    it("returns empty array when no events buffered", async () => {
      const res = await fetchWithToken(port, "/api/events");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.events).toEqual([]);
    });

    it("returns all buffered events", async () => {
      const emit = pushEvents(handle);
      emit(makeWorkflowStartedEvent({ workflow: "builder" }));
      emit(makeWorkflowCompletedEvent({ workflow: "builder" }));

      const res = await fetchWithToken(port, "/api/events");
      const body = await res.json();
      expect(body.events).toHaveLength(2);
      expect(body.events[0].id).toBe("evt-1");
      expect(body.events[1].id).toBe("evt-2");
      expect(body.events[0].type).toBe("workflow.started");
      expect(body.events[1].type).toBe("workflow.completed");
    });

    it("filters by type prefix", async () => {
      const emit = pushEvents(handle);
      emit(makeWorkflowStartedEvent({ workflow: "a" }));
      emit(makeTaskChangedEvent());
      emit(makeWorkflowCompletedEvent({ workflow: "a" }));

      const res = await fetchWithToken(port, "/api/events?type=workflow");
      const body = await res.json();
      expect(body.events).toHaveLength(2);
      expect(body.events.every((e: { type: string }) => e.type.startsWith("workflow"))).toBe(true);
    });

    it("filters by type glob pattern", async () => {
      const emit = pushEvents(handle);
      emit(makeWorkflowStartedEvent());
      emit(makeWorkflowCompletedEvent());
      emit({
        type: "workflow.step.completed",
        payload: {
          projectId: "test-project",
          workflow: "builder",
          runId: "test-run",
          stepId: "step-1",
          stepType: "agent",
          status: "success",
          durationMs: 0,
          runDir: "",
          definitionPath: "",
        },
      });
      emit(makeTaskChangedEvent());

      const res = await fetchWithToken(port, "/api/events?type=workflow.*completed");
      const body = await res.json();
      expect(body.events).toHaveLength(2);
      expect(body.events.map((e: { type: string }) => e.type)).toEqual([
        "workflow.completed",
        "workflow.step.completed",
      ]);
    });

    it("treats glob regex metacharacters as literal event type text", async () => {
      const emit = pushEvents(handle);
      emit(makeWorkflowStartedEvent());

      const res = await fetchWithToken(port, "/api/events?type=*%5B");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.events).toEqual([]);
    });

    it("filters by since timestamp", async () => {
      const emit = pushEvents(handle);
      emit(makeWorkflowStartedEvent());

      await new Promise((r) => setTimeout(r, 50));
      const cutoff = new Date().toISOString();
      await new Promise((r) => setTimeout(r, 50));

      emit(makeWorkflowCompletedEvent());

      const res = await fetchWithToken(port, `/api/events?since=${encodeURIComponent(cutoff)}`);
      const body = await res.json();
      expect(body.events).toHaveLength(1);
      expect(body.events[0].type).toBe("workflow.completed");
    });

    it("limits result count", async () => {
      const emit = pushEvents(handle);
      for (let i = 0; i < 10; i++) {
        emit(makeWorkflowStartedEvent({ runId: `run-${i}` }));
      }

      const res = await fetchWithToken(port, "/api/events?limit=3");
      const body = await res.json();
      expect(body.events).toHaveLength(3);
      expect(body.events[0].payload.runId).toBe("run-7");
    });

    it("combines type filter and limit", async () => {
      const emit = pushEvents(handle);
      for (let i = 0; i < 5; i++) {
        emit(makeWorkflowStartedEvent({ runId: `run-${i}` }));
        emit(makeTaskChangedEvent());
      }

      const res = await fetchWithToken(port, "/api/events?type=workflow&limit=2");
      const body = await res.json();
      expect(body.events).toHaveLength(2);
      expect(body.events.every((e: { type: string }) => e.type.startsWith("workflow"))).toBe(true);
      expect(body.events[0].payload.runId).toBe("run-3");
      expect(body.events[1].payload.runId).toBe("run-4");
    });

    it("includes timestamp in ISO format", async () => {
      const emit = pushEvents(handle);
      emit(makeWorkflowStartedEvent());

      const res = await fetchWithToken(port, "/api/events");
      const body = await res.json();
      expect(body.events[0].id).toBe("evt-1");
      expect(body.events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("filters by after event id without returning the cursor event", async () => {
      const emit = pushEvents(handle);
      emit(makeWorkflowStartedEvent({ runId: "run-1" }));
      emit(makeWorkflowStartedEvent({ runId: "run-2" }));
      emit(makeWorkflowCompletedEvent({ runId: "run-3" }));

      const res = await fetchWithToken(port, "/api/events?after=evt-2");
      const body = await res.json();
      expect(body.events).toHaveLength(1);
      expect(body.events[0]).toMatchObject({
        id: "evt-3",
        type: "workflow.completed",
        payload: { runId: "run-3" },
      });
    });
  });
});
