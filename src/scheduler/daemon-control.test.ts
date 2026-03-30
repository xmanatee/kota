import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DaemonControlHandle,
  DaemonControlServer,
  type DaemonSseEvent,
  type WorkflowLiveStatus,
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
  };
  return {
    getDaemonLiveState: vi.fn(() => ({
      startedAt: "2026-01-01T00:00:00.000Z",
      completedRuns: 0,
      pid: 9999,
      running: true,
    })),
    getWorkflowLiveStatus: vi.fn(() => ({ ...defaultWorkflowStatus })),
    pauseWorkflowDispatch: vi.fn(() => ({ already: false })),
    resumeWorkflowDispatch: vi.fn(() => ({ already: false })),
    abortActiveRuns: vi.fn(() => ({ aborted: 0 })),
    reloadWorkflowDefinitions: vi.fn(() => ({ count: 3 })),
    enqueuePendingRun: vi.fn(() => ({ ok: true, queued: "builder" })),
    subscribeToEvents: vi.fn(() => () => {}),
    listHistory: vi.fn(() => []),
    getHistory: vi.fn(() => null),
    deleteHistory: vi.fn(() => false),
    listApprovals: vi.fn(() => []),
    approveApproval: vi.fn(() => null),
    rejectApproval: vi.fn(() => null),
    getTaskStatus: vi.fn(() => ({ counts: { inbox: 0, ready: 0, backlog: 0, doing: 0, blocked: 0 }, tasks: { doing: [], ready: [], backlog: [], blocked: [] } })),
    listWorkflowRuns: vi.fn(() => []),
    getWorkflowRun: vi.fn(() => null),
    registerSession: vi.fn(),
    unregisterSession: vi.fn(),
    listSessions: vi.fn(() => []),
    triggerWebhookRun: vi.fn(() => ({ ok: false, notFound: true })),
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
      expect(body).toMatchObject({ ok: true, queued: "builder" });
      expect(handle.enqueuePendingRun).toHaveBeenCalledWith("builder");
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

    function makeWebhookHandle(overrides: Partial<DaemonControlHandle> = {}): DaemonControlHandle {
      return makeHandle({
        triggerWebhookRun: vi.fn((_name: string, secret: string, _payload: unknown) => {
          if (secret !== WEBHOOK_SECRET) return { ok: false, unauthorized: true };
          return { ok: true, runId: "2026-01-01T00-00-00-000Z-deploy-abc123" };
        }),
        ...overrides,
      });
    }

    it("returns 200 with runId when secret is correct", async () => {
      handle = makeWebhookHandle();
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
        method: "POST",
        headers: { "X-Kota-Webhook-Secret": WEBHOOK_SECRET, "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "refs/heads/main" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ runId: "2026-01-01T00-00-00-000Z-deploy-abc123" });
    });

    it("returns 401 when secret is missing", async () => {
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

    it("returns 401 when secret is wrong", async () => {
      handle = makeWebhookHandle();
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
        method: "POST",
        headers: { "X-Kota-Webhook-Secret": "wrong-secret" },
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
        headers: { "X-Kota-Webhook-Secret": WEBHOOK_SECRET },
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
        headers: { "X-Kota-Webhook-Secret": WEBHOOK_SECRET },
      });
      expect(res.status).toBe(409);
    });

    it("does not require daemon Bearer token", async () => {
      handle = makeWebhookHandle();
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      // No Authorization header, only webhook secret
      const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
        method: "POST",
        headers: { "X-Kota-Webhook-Secret": WEBHOOK_SECRET },
      });
      expect(res.status).toBe(200);
    });

    it("passes request body and headers to handle", async () => {
      const triggerFn = vi.fn(() => ({ ok: true, runId: "test-run-id" }));
      handle = makeHandle({ triggerWebhookRun: triggerFn });
      await server.stop();
      server = new DaemonControlServer(handle, TEST_TOKEN);
      port = await server.start();

      await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
        method: "POST",
        headers: { "X-Kota-Webhook-Secret": WEBHOOK_SECRET, "Content-Type": "application/json" },
        body: JSON.stringify({ event: "push" }),
      });

      expect(triggerFn).toHaveBeenCalledWith(
        "deploy",
        WEBHOOK_SECRET,
        expect.objectContaining({
          body: { event: "push" },
          headers: expect.objectContaining({ "content-type": "application/json" }),
          timestamp: expect.any(String),
        }),
      );
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
      expect(handle.listWorkflowRuns).toHaveBeenCalledWith("builder", 5);
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
      expect(handle.approveApproval).toHaveBeenCalledWith("appr-1");
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
});
