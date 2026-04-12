import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DaemonControlHandle,
  DaemonControlServer,
  type DaemonSseEvent,
  type WorkflowLiveStatus,
  type WorkflowMetricCounts,
} from "./daemon-control.js";

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
    listHistory: vi.fn(() => []),
    getHistory: vi.fn(() => null),
    deleteHistory: vi.fn(() => false),
    listApprovals: vi.fn(() => []),
    approveApproval: vi.fn(() => null),
    rejectApproval: vi.fn(() => null),
    approveAllApprovals: vi.fn(() => []),
    rejectAllApprovals: vi.fn(() => []),
    getTaskStatus: vi.fn(() => ({ counts: { inbox: 0, ready: 0, backlog: 0, doing: 0, blocked: 0 }, tasks: { doing: [], ready: [], backlog: [], blocked: [] } })),
    listWorkflowRuns: vi.fn(() => []),
    getWorkflowRun: vi.fn(() => null),
    getWorkflowMetricCounts: vi.fn((): WorkflowMetricCounts => ({ runCounts: [], costTotals: [], durationHistogram: [] })),
    registerSession: vi.fn(),
    unregisterSession: vi.fn(),
    listSessions: vi.fn(() => []),
    triggerWebhookRun: vi.fn(() => ({ ok: false, notFound: true })),
    reloadConfig: vi.fn(async () => ({ workflows: 3, changedModules: [] as string[] })),
    registerPushToken: vi.fn(),
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
      eventHandler!({ type: "workflow.started", payload: { workflow: "builder", runId: "run-1" } });

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

  describe("POST /webhooks/:name", () => {
    const WEBHOOK_SECRET = "test-webhook-secret";

    function sign(secret: string, body: string | Buffer): string {
      return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    }

    function makeWebhookHandle(overrides: Partial<DaemonControlHandle> = {}): DaemonControlHandle {
      return makeHandle({
        triggerWebhookRun: vi.fn((_name: string, _sig: string, _rawBody: Buffer, _payload: unknown) => {
          return { ok: true, runId: "2026-01-01T00-00-00-000Z-deploy-abc123" };
        }),
        ...overrides,
      });
    }

    it("returns 200 with runId when signature is correct", async () => {
      handle = makeWebhookHandle();
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const bodyStr = JSON.stringify({ ref: "refs/heads/main" });
      const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
        method: "POST",
        headers: {
          "X-Kota-Webhook-Signature": sign(WEBHOOK_SECRET, bodyStr),
          "Content-Type": "application/json",
        },
        body: bodyStr,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ runId: "2026-01-01T00-00-00-000Z-deploy-abc123" });
    });

    it("returns 401 when signature header is missing", async () => {
      handle = makeWebhookHandle();
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 when signature is wrong", async () => {
      handle = makeHandle({
        triggerWebhookRun: vi.fn(() => ({ ok: false, unauthorized: true })),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
        method: "POST",
        headers: { "X-Kota-Webhook-Signature": "sha256=badhex" },
      });
      expect(res.status).toBe(401);
    });

    it("returns 404 when workflow not found", async () => {
      handle = makeHandle({
        triggerWebhookRun: vi.fn(() => ({ ok: false, notFound: true })),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/unknown`, {
        method: "POST",
        headers: { "X-Kota-Webhook-Signature": sign(WEBHOOK_SECRET, "") },
      });
      expect(res.status).toBe(404);
    });

    it("returns 409 when workflow is already running", async () => {
      handle = makeHandle({
        triggerWebhookRun: vi.fn(() => ({ ok: false, alreadyRunning: true })),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
        method: "POST",
        headers: { "X-Kota-Webhook-Signature": sign(WEBHOOK_SECRET, "") },
      });
      expect(res.status).toBe(409);
    });

    it("does not require daemon Bearer token", async () => {
      handle = makeWebhookHandle();
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      // No Authorization header, only webhook signature
      const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
        method: "POST",
        headers: { "X-Kota-Webhook-Signature": sign(WEBHOOK_SECRET, "") },
      });
      expect(res.status).toBe(200);
    });

    it("passes signature, rawBody, payload, and optional timestamp to handle", async () => {
      const triggerFn = vi.fn(() => ({ ok: true, runId: "test-run-id" }));
      handle = makeHandle({ triggerWebhookRun: triggerFn });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const bodyStr = JSON.stringify({ event: "push" });
      const ts = String(Date.now());
      await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
        method: "POST",
        headers: {
          "X-Kota-Webhook-Signature": sign(WEBHOOK_SECRET, bodyStr),
          "X-Kota-Webhook-Timestamp": ts,
          "Content-Type": "application/json",
        },
        body: bodyStr,
      });

      expect(triggerFn).toHaveBeenCalledWith(
        "deploy",
        expect.stringMatching(/^sha256=[0-9a-f]{64}$/),
        expect.any(Buffer),
        expect.objectContaining({
          body: { event: "push" },
          headers: expect.objectContaining({ "content-type": "application/json" }),
          timestamp: expect.any(String),
        }),
        ts,
      );
    });

    it("returns 429 with Retry-After header when rate limit is exceeded", async () => {
      handle = makeHandle({
        triggerWebhookRun: vi.fn(() => ({ ok: false, rateLimited: true, retryAfterMs: 30_000 })),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
        method: "POST",
        headers: { "X-Kota-Webhook-Signature": sign(WEBHOOK_SECRET, "") },
      });
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("30");
      const body = await res.json();
      expect(body).toMatchObject({ error: expect.stringContaining("rate limit"), retryAfterSec: 30 });
    });

    it("enforces timestamp replay window when X-Kota-Webhook-Timestamp is present", async () => {
      handle = makeHandle({
        triggerWebhookRun: vi.fn((_name, _sig, _buf, _payload, webhookTimestamp) => {
          const ts = parseInt(webhookTimestamp ?? "", 10);
          if (Number.isNaN(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
            return { ok: false, unauthorized: true };
          }
          return { ok: true, runId: "test-run-id" };
        }),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      // Stale timestamp (10 minutes ago)
      const staleTs = String(Date.now() - 10 * 60 * 1000);
      const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
        method: "POST",
        headers: {
          "X-Kota-Webhook-Signature": sign(WEBHOOK_SECRET, ""),
          "X-Kota-Webhook-Timestamp": staleTs,
        },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /history", () => {
    it("returns 200 with empty conversations list", async () => {
      const res = await fetchWithToken(port, "/history");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ conversations: [] });
      expect(handle.listHistory).toHaveBeenCalled();
    });

    it("returns conversations from handle", async () => {
      const record = { id: "conv-1", title: "Test", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", model: "claude-opus-4-6", messageCount: 2, cwd: "/tmp" };
      handle = makeHandle({ listHistory: vi.fn(() => [record]) });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/history");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.conversations).toHaveLength(1);
      expect(body.conversations[0].id).toBe("conv-1");
    });

    it("passes search and limit query params to handle", async () => {
      const res = await fetchWithToken(port, "/history?search=foo&limit=5");
      expect(res.status).toBe(200);
      expect(handle.listHistory).toHaveBeenCalledWith("foo", 5);
    });

    it("returns 401 without token", async () => {
      const res = await fetchNoToken(port, "/history");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /history/:id", () => {
    it("returns 200 with conversation data when found", async () => {
      const record = { id: "conv-1", title: "Test", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", model: "claude-opus-4-6", messageCount: 2, cwd: "/tmp" };
      const data = { record, messages: [], compactionCount: 0, lastInputTokens: 0 };
      handle = makeHandle({ getHistory: vi.fn(() => data) });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/history/conv-1");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.record.id).toBe("conv-1");
      expect(handle.getHistory).toHaveBeenCalledWith("conv-1");
    });

    it("returns 404 when conversation not found", async () => {
      const res = await fetchWithToken(port, "/history/missing-id");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it("returns 401 without token", async () => {
      const res = await fetchNoToken(port, "/history/conv-1");
      expect(res.status).toBe(401);
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

  describe("GET /approvals", () => {
    it("returns 200 with empty approvals list", async () => {
      const res = await fetchWithToken(port, "/approvals");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ approvals: [] });
      expect(handle.listApprovals).toHaveBeenCalled();
    });

    it("returns approvals from handle", async () => {
      const approval = { id: "appr-1", tool: "Bash", input: { command: "ls" }, risk: "dangerous" as const, reason: "needs approval", createdAt: "2026-01-01T00:00:00.000Z", status: "pending" as const };
      handle = makeHandle({ listApprovals: vi.fn(() => [approval]) });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/approvals");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.approvals).toHaveLength(1);
      expect(body.approvals[0].id).toBe("appr-1");
    });

    it("returns 401 without token", async () => {
      const res = await fetchNoToken(port, "/approvals");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /approvals/:id/approve", () => {
    it("returns 200 with approval when found", async () => {
      const approval = { id: "appr-1", tool: "Bash", input: { command: "ls" }, risk: "dangerous" as const, reason: "needs approval", createdAt: "2026-01-01T00:00:00.000Z", status: "approved" as const, resolvedAt: "2026-01-01T00:01:00.000Z" };
      handle = makeHandle({ approveApproval: vi.fn(() => approval) });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/approvals/appr-1/approve", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.approval.id).toBe("appr-1");
      expect(handle.approveApproval).toHaveBeenCalledWith("appr-1", undefined);
    });

    it("passes note from request body to handle", async () => {
      const approval = { id: "appr-1", tool: "Bash", input: {}, risk: "safe" as const, reason: "test", createdAt: "2026-01-01T00:00:00.000Z", status: "approved" as const, approvalNote: "please add a test" };
      handle = makeHandle({ approveApproval: vi.fn(() => approval) });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/approvals/appr-1/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "please add a test" }),
      });
      expect(res.status).toBe(200);
      expect(handle.approveApproval).toHaveBeenCalledWith("appr-1", "please add a test");
    });

    it("returns 404 when approval not found", async () => {
      const res = await fetchWithToken(port, "/approvals/missing/approve", { method: "POST" });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it("returns 401 without token", async () => {
      const res = await fetchNoToken(port, "/approvals/appr-1/approve", { method: "POST" });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /approvals/:id/reject", () => {
    it("returns 200 with approval when found", async () => {
      const approval = { id: "appr-1", tool: "Bash", input: { command: "ls" }, risk: "dangerous" as const, reason: "needs approval", createdAt: "2026-01-01T00:00:00.000Z", status: "rejected" as const, resolvedAt: "2026-01-01T00:01:00.000Z", rejectionReason: "too risky" };
      handle = makeHandle({ rejectApproval: vi.fn(() => approval) });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/approvals/appr-1/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "too risky" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.approval.id).toBe("appr-1");
      expect(handle.rejectApproval).toHaveBeenCalledWith("appr-1", "too risky");
    });

    it("accepts reject without a reason body", async () => {
      const approval = { id: "appr-1", tool: "Bash", input: {}, risk: "safe" as const, reason: "test", createdAt: "2026-01-01T00:00:00.000Z", status: "rejected" as const };
      handle = makeHandle({ rejectApproval: vi.fn(() => approval) });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/approvals/appr-1/reject", { method: "POST" });
      expect(res.status).toBe(200);
      expect(handle.rejectApproval).toHaveBeenCalledWith("appr-1", undefined);
    });

    it("returns 404 when approval not found", async () => {
      const res = await fetchWithToken(port, "/approvals/missing/reject", { method: "POST" });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it("returns 401 without token", async () => {
      const res = await fetchNoToken(port, "/approvals/appr-1/reject", { method: "POST" });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /tasks", () => {
    it("returns 200 with task status", async () => {
      const res = await fetchWithToken(port, "/tasks");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        counts: { inbox: 0, ready: 0, backlog: 0, doing: 0, blocked: 0 },
        tasks: { doing: [], ready: [], backlog: [], blocked: [] },
      });
      expect(handle.getTaskStatus).toHaveBeenCalled();
    });

    it("returns task data from handle", async () => {
      const taskStatus = {
        counts: { inbox: 0, ready: 1, backlog: 0, doing: 0, blocked: 0 },
        tasks: {
          doing: [],
          ready: [{ id: "task-1", title: "Fix bug", priority: "p1", area: "core", summary: "A bug", body: "" }],
          backlog: [],
          blocked: [],
        },
      };
      handle = makeHandle({ getTaskStatus: vi.fn(() => taskStatus) });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/tasks");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.counts.ready).toBe(1);
      expect(body.tasks.ready).toHaveLength(1);
    });

    it("returns 401 without token", async () => {
      const res = await fetchNoToken(port, "/tasks");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /metrics", () => {
    it("returns 200 with Prometheus text format", async () => {
      const res = await fetchWithToken(port, "/metrics");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
      const text = await res.text();
      expect(text).toContain("# TYPE kota_workflow_runs_total counter");
      expect(text).toContain("# TYPE kota_workflow_cost_usd_total counter");
      expect(text).toContain("# TYPE kota_active_sessions_total gauge");
      expect(text).toContain("# TYPE kota_pending_approvals_total gauge");
      expect(text).toContain("# TYPE kota_dispatch_paused gauge");
      expect(text).toContain("# TYPE kota_workflow_active_runs gauge");
      expect(text).toContain("# TYPE kota_workflow_queued_runs gauge");
      expect(text).toContain("kota_active_sessions_total 0");
      expect(text).toContain("kota_pending_approvals_total 0");
      expect(text).toContain("kota_dispatch_paused 0");
      expect(text).toContain("kota_workflow_queued_runs 0");
    });

    it("includes per-workflow run counts and costs", async () => {
      const metricCounts: WorkflowMetricCounts = {
        runCounts: [
          { workflow: "builder", status: "success", count: 10 },
          { workflow: "builder", status: "failed", count: 2 },
          { workflow: "explorer", status: "success", count: 5 },
        ],
        costTotals: [
          { workflow: "builder", costUsd: 1.5 },
        ],
        durationHistogram: [],
      };
      handle = makeHandle({
        getWorkflowMetricCounts: vi.fn(() => metricCounts),
        listSessions: vi.fn(() => [{ id: "s1", createdAt: "2026-01-01T00:00:00Z", lastActive: 0 }]),
        listApprovals: vi.fn(() => [{ id: "a1", tool: "Bash", input: {}, risk: "moderate" as const, reason: "test", createdAt: "2026-01-01T00:00:00Z", status: "pending" as const }]),
        getWorkflowLiveStatus: vi.fn(() => ({
          activeRuns: [], pendingRuns: [], queueLength: 0, completedRuns: 17, workflows: {}, paused: true,
          agentConcurrency: 1, codeConcurrency: 4,
        })),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/metrics");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('kota_workflow_runs_total{workflow="builder",status="success"} 10');
      expect(text).toContain('kota_workflow_runs_total{workflow="builder",status="failed"} 2');
      expect(text).toContain('kota_workflow_runs_total{workflow="explorer",status="success"} 5');
      expect(text).toContain('kota_workflow_cost_usd_total{workflow="builder"} 1.5');
      expect(text).toContain("kota_active_sessions_total 1");
      expect(text).toContain("kota_pending_approvals_total 1");
      expect(text).toContain("kota_dispatch_paused 1");
    });

    it("includes active-run and queue-depth gauges with non-zero values", async () => {
      handle = makeHandle({
        getWorkflowLiveStatus: vi.fn(() => ({
          activeRuns: [
            { runId: "run-1", workflow: "builder", startedAt: "2026-01-01T00:00:00Z" },
            { runId: "run-2", workflow: "builder", startedAt: "2026-01-01T00:01:00Z" },
            { runId: "run-3", workflow: "explorer", startedAt: "2026-01-01T00:02:00Z" },
          ],
          pendingRuns: [],
          queueLength: 3,
          completedRuns: 0,
          workflows: {},
          paused: false,
          agentConcurrency: 1,
          codeConcurrency: 4,
        })),
      });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/metrics");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("# TYPE kota_workflow_active_runs gauge");
      expect(text).toContain('kota_workflow_active_runs{workflow="builder"} 2');
      expect(text).toContain('kota_workflow_active_runs{workflow="explorer"} 1');
      expect(text).toContain("# TYPE kota_workflow_queued_runs gauge");
      expect(text).toContain("kota_workflow_queued_runs 3");
    });

    it("includes duration histogram buckets when durationHistogram is non-empty", async () => {
      const metricCounts: WorkflowMetricCounts = {
        runCounts: [],
        costTotals: [],
        durationHistogram: [
          {
            workflow: "builder",
            status: "success",
            buckets: [
              { le: 30, count: 0 },
              { le: 120, count: 2 },
              { le: 300, count: 5 },
              { le: 900, count: 10 },
              { le: 1800, count: 12 },
              { le: 3600, count: 14 },
              { le: "+Inf", count: 14 },
            ],
            sum: 9480,
            count: 14,
          },
        ],
      };
      handle = makeHandle({ getWorkflowMetricCounts: vi.fn(() => metricCounts) });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await fetchWithToken(port, "/metrics");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("# TYPE kota_workflow_run_duration_seconds histogram");
      expect(text).toContain('kota_workflow_run_duration_seconds_bucket{workflow="builder",status="success",le="1800"} 12');
      expect(text).toContain('kota_workflow_run_duration_seconds_bucket{workflow="builder",status="success",le="+Inf"} 14');
      expect(text).toContain('kota_workflow_run_duration_seconds_sum{workflow="builder",status="success"} 9480');
      expect(text).toContain('kota_workflow_run_duration_seconds_count{workflow="builder",status="success"} 14');
    });

    it("returns 401 without token", async () => {
      const res = await fetchNoToken(port, "/metrics");
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

  describe("POST /push-tokens", () => {
    it("registers a push token and returns 200", async () => {
      const res = await fetchWithToken(port, "/push-tokens", {
        method: "POST",
        body: JSON.stringify({ deviceId: "test-device-1", token: "ExponentPushToken[abc123]" }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
      expect((handle.registerPushToken as ReturnType<typeof vi.fn>).mock.calls).toContainEqual(["test-device-1", "ExponentPushToken[abc123]"]);
    });

    it("returns 400 when token is missing", async () => {
      const res = await fetchWithToken(port, "/push-tokens", {
        method: "POST",
        body: JSON.stringify({ deviceId: "test-device-1" }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when deviceId is missing", async () => {
      const res = await fetchWithToken(port, "/push-tokens", {
        method: "POST",
        body: JSON.stringify({ token: "ExponentPushToken[abc123]" }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(400);
    });

    it("returns 401 without token", async () => {
      const res = await fetchNoToken(port, "/push-tokens", { method: "POST" });
      expect(res.status).toBe(401);
    });
  });
});
