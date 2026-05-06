import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DaemonControlHandle,
  DaemonControlServer,
  type DaemonSseEvent,
  type WorkflowLiveStatus,
  type WorkflowMetricCounts,
} from "./daemon-control.js";
import {
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
    reloadConfig: vi.fn(async () => ({ workflows: 3, changedModules: [] as string[] })),
    probeCapabilityReadiness: vi.fn(async () => ({
      capabilities: [],
      summary: { ready: 0, unavailable: 0, init_failed: 0 },
    })),
    getClientIdentity: vi.fn(async () => ({
      projectName: "test-project",
      projectDir: "/tmp/test-project",
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
      expect(handle.enqueuePendingRun).toHaveBeenCalledWith("builder", undefined, undefined);
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
      expect(body).toMatchObject({ ok: true, workflows: 3, changedModules: [] });
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
      expect(handle.disableWorkflow).toHaveBeenCalledWith("builder");
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
      expect(handle.enableWorkflow).toHaveBeenCalledWith("builder");
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
      expect(handle.listWorkflowRuns).toHaveBeenCalledWith("builder", 5, undefined, undefined);
    });

    it("passes tag filter to handle", async () => {
      const res = await fetchWithToken(port, "/workflow/runs?tag=my-tag");
      expect(res.status).toBe(200);
      expect(handle.listWorkflowRuns).toHaveBeenCalledWith(undefined, 20, "my-tag", undefined);
    });

    it("passes causedByRunId filter to handle", async () => {
      const res = await fetchWithToken(port, "/workflow/runs?causedByRunId=upstream-run-id");
      expect(res.status).toBe(200);
      expect(handle.listWorkflowRuns).toHaveBeenCalledWith(undefined, 20, undefined, "upstream-run-id");
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
      expect(handle.getWorkflowRun).toHaveBeenCalledWith("run-1");
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
      expect(handle.cancelQueuedRun).toHaveBeenCalledWith("2026-01-01T00-00-00-000Z-builder-abc123");
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
      expect(handle.abortActiveRun).toHaveBeenCalledWith("2026-01-01T00-00-00-000Z-builder-abc123");
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
      expect(body.events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});
