import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DaemonControlHandle,
  DaemonControlServer,
  type WorkflowLiveStatus,
} from "./daemon-control.js";

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
    ...overrides,
  };
}

async function fetch(port: number, path: string, options: RequestInit = {}): Promise<Response> {
  return globalThis.fetch(`http://127.0.0.1:${port}${path}`, options);
}

describe("DaemonControlServer", () => {
  let server: DaemonControlServer;
  let handle: DaemonControlHandle;
  let port: number;

  beforeEach(async () => {
    handle = makeHandle();
    server = new DaemonControlServer(handle);
    port = await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  describe("GET /status", () => {
    it("returns 200 with daemon and workflow state", async () => {
      const res = await fetch(port, "/status");
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
      const res = await fetch(port, "/workflow/status");
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
      server = new DaemonControlServer(handle);
      port = await server.start();

      const res = await fetch(port, "/workflow/status");
      const body = await res.json();
      expect(body.paused).toBe(true);
    });
  });

  describe("POST /workflow/trigger", () => {
    it("enqueues a valid workflow and returns 200", async () => {
      const res = await fetch(port, "/workflow/trigger", {
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
      const res = await fetch(port, "/workflow/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it("returns 400 when name is missing", async () => {
      const res = await fetch(port, "/workflow/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when name contains invalid characters", async () => {
      const res = await fetch(port, "/workflow/trigger", {
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
      server = new DaemonControlServer(handle);
      port = await server.start();

      const res = await fetch(port, "/workflow/trigger", {
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
      server = new DaemonControlServer(handle);
      port = await server.start();

      const res = await fetch(port, "/workflow/trigger", {
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
      const res = await fetch(port, "/workflow/pause", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, paused: true });
      expect(body.already).toBeUndefined();
    });

    it("includes already:true when already paused", async () => {
      handle = makeHandle({ pauseWorkflowDispatch: vi.fn(() => ({ already: true })) });
      await server.stop();
      server = new DaemonControlServer(handle);
      port = await server.start();

      const res = await fetch(port, "/workflow/pause", { method: "POST" });
      const body = await res.json();
      expect(body.already).toBe(true);
    });
  });

  describe("POST /workflow/resume", () => {
    it("resumes dispatch and returns ok", async () => {
      const res = await fetch(port, "/workflow/resume", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, paused: false });
      expect(body.already).toBeUndefined();
    });

    it("includes already:true when already running", async () => {
      handle = makeHandle({ resumeWorkflowDispatch: vi.fn(() => ({ already: true })) });
      await server.stop();
      server = new DaemonControlServer(handle);
      port = await server.start();

      const res = await fetch(port, "/workflow/resume", { method: "POST" });
      const body = await res.json();
      expect(body.already).toBe(true);
    });
  });

  describe("POST /workflow/abort", () => {
    it("aborts active runs and returns count", async () => {
      handle = makeHandle({ abortActiveRuns: vi.fn(() => ({ aborted: 2 })) });
      await server.stop();
      server = new DaemonControlServer(handle);
      port = await server.start();

      const res = await fetch(port, "/workflow/abort", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, aborted: 2 });
    });
  });

  describe("POST /workflow/reload", () => {
    it("reloads definitions and returns count", async () => {
      const res = await fetch(port, "/workflow/reload", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, count: 3 });
    });
  });

  describe("unknown routes", () => {
    it("returns 404 for an unrecognized path", async () => {
      const res = await fetch(port, "/does-not-exist");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it("returns 404 for wrong method on known path", async () => {
      const res = await fetch(port, "/status", { method: "POST" });
      expect(res.status).toBe(404);
    });
  });
});
