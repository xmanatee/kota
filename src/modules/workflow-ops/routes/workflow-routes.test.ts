import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowLiveStatus } from "#core/daemon/daemon-control.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import {
  handleWorkflowAbort,
  handleWorkflowCancel,
  handleWorkflowDefinitions,
  handleWorkflowPause,
  handleWorkflowReplay,
  handleWorkflowResume,
  handleWorkflowRetry,
  handleWorkflowStatus,
  handleWorkflowTrigger,
} from "./workflow-routes.js";
import {
  handleWorkflowRunArtifacts,
  handleWorkflowRunDetail,
  handleWorkflowRunStream,
  handleWorkflowRuns,
  listRunMetadata,
} from "./workflow-run-routes.js";

function makeProjectDir(): string {
  const dir = join(
    tmpdir(),
    `kota-wf-routes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(join(dir, ".kota", "runs"), { recursive: true });
  return dir;
}

function writeRunMetadata(
  runsDir: string,
  id: string,
  workflow: string,
  status: string,
  overrides: Record<string, unknown> = {},
): void {
  const runDir = join(runsDir, id);
  mkdirSync(runDir, { recursive: true });
  const metadata = {
    id,
    workflow,
    definitionPath: `src/modules/test/workflows/${workflow}/workflow.ts`,
    trigger: { event: "runtime.idle", payload: {} },
    startedAt: new Date(1700000000000).toISOString(),
    status,
    completedAt: new Date(1700001000000).toISOString(),
    durationMs: 1000,
    totalCostUsd: 0.05,
    runDir: `.kota/runs/${id}`,
    steps: [
      {
        id: "step-1",
        type: "agent",
        status: "success",
        startedAt: new Date(1700000000000).toISOString(),
        completedAt: new Date(1700001000000).toISOString(),
        durationMs: 1000,
      },
    ],
    ...overrides,
  };
  writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata));
}

function mockResponse() {
  const result = { status: 0, body: null as unknown };
  const res = {
    setHeader: vi.fn(),
    writeHead: (s: number) => {
      result.status = s;
    },
    end: (data: string) => {
      result.body = JSON.parse(data);
    },
    on: vi.fn(),
  } as unknown as ServerResponse;
  return { res, result };
}

type MockTransportSpec = Partial<{
  status: WorkflowLiveStatus | null;
  definitions: { definitions: unknown[] } | null;
  pause: { ok: boolean; paused: boolean; already?: boolean } | null;
  resume: { ok: boolean; paused: boolean; already?: boolean } | null;
  abort: { ok: boolean; aborted: number } | null;
  /**
   * Trigger response. Use a thrower (`{ throws: true }`) to simulate a
   * network error and force the offline-fallback path.
   */
  trigger: { ok: true; queued: string; runId?: string } | { ok: false; alreadyQueued: true } | { throws: true } | null;
  cancel: { status: number; body?: unknown };
  abortRun: { status: number; body?: unknown };
  enable: { status: number; body?: unknown };
  disable: { status: number; body?: unknown };
  /**
   * Captured call log; tests inspect this to assert paths/bodies.
   */
  log?: Array<{ method: string; path: string; body?: unknown }>;
}>;

function mockTransport(spec: MockTransportSpec = {}): DaemonTransport & {
  /** Recorded calls; useful for assertions on path/payload. */
  calls: Array<{ method: string; path: string; body?: unknown }>;
} {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];

  const transport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({}),
    calls,
    request: vi.fn(async <T,>(method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      if (method === "GET" && path === "/workflow/status") {
        const v = "status" in spec ? spec.status : {
          activeRuns: [],
          pendingRuns: [],
          queueLength: 0,
          completedRuns: 0,
          workflows: {},
          paused: false,
          agentConcurrency: 1,
          codeConcurrency: 4,
        };
        return v as T | null;
      }
      if (method === "GET" && path === "/workflow/definitions") {
        return ("definitions" in spec ? spec.definitions : { definitions: [] }) as T | null;
      }
      if (method === "POST" && path === "/workflow/pause") {
        return ("pause" in spec ? spec.pause : { ok: true, paused: true }) as T | null;
      }
      if (method === "POST" && path === "/workflow/resume") {
        return ("resume" in spec ? spec.resume : { ok: true, paused: false }) as T | null;
      }
      if (method === "POST" && path === "/workflow/abort") {
        return ("abort" in spec ? spec.abort : { ok: true, aborted: 0 }) as T | null;
      }
      return null;
    }),
    requestStrict: vi.fn(async () => {
      throw new Error("requestStrict not configured");
    }),
    fetchRaw: vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      let body: unknown ;
      if (init?.body !== undefined && init.body !== null) {
        try {
          body = JSON.parse(String(init.body));
        } catch {
          body = init.body;
        }
      }
      calls.push({ method, path, body });
      if (path === "/workflow/trigger" && method === "POST") {
        const t = spec.trigger;
        if (t == null) return makeFakeResponse(503, { error: "Daemon not reachable" });
        if ("throws" in t) throw new Error("network");
        if ("alreadyQueued" in t && t.alreadyQueued) return makeFakeResponse(409, { error: "queued" });
        return makeFakeResponse(200, t);
      }
      if (path.endsWith("/abort") && path.startsWith("/workflow/runs/") && method === "POST") {
        const r = spec.abortRun ?? { status: 200, body: { ok: true } };
        return makeFakeResponse(r.status, r.body ?? {});
      }
      if (path.startsWith("/workflow/runs/") && method === "DELETE") {
        const r = spec.cancel ?? { status: 200, body: { ok: true } };
        return makeFakeResponse(r.status, r.body ?? {});
      }
      if (path.startsWith("/workflow/definitions/") && path.endsWith("/enable") && method === "POST") {
        const r = spec.enable ?? { status: 200, body: { ok: true } };
        return makeFakeResponse(r.status, r.body ?? {});
      }
      if (path.startsWith("/workflow/definitions/") && path.endsWith("/disable") && method === "POST") {
        const r = spec.disable ?? { status: 200, body: { ok: true } };
        return makeFakeResponse(r.status, r.body ?? {});
      }
      return makeFakeResponse(200, {});
    }),
    events: vi.fn(async function* () {
      // No events by default.
    }),
  };
  return transport as unknown as DaemonTransport & {
    calls: Array<{ method: string; path: string; body?: unknown }>;
  };
}

function makeFakeResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => text,
    body: null,
    headers: new Headers(),
  } as unknown as Response;
}


describe("workflow-routes", () => {
  let projectDir: string;
  let store: WorkflowRunStore;
  let runsDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
    store = new WorkflowRunStore(projectDir);
    runsDir = join(projectDir, ".kota", "runs");
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe("handleWorkflowStatus", () => {
    it("returns empty state when daemon not running (null client)", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowStatus(res, null);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        activeRuns: [],
        queueLength: 0,
        completedRuns: 0,
        workflows: {},
        paused: false,
      });
    });

    it("returns empty state when daemon unreachable (client returns null)", async () => {
      const client = mockTransport({ status: null });
      const { res, result } = mockResponse();
      await handleWorkflowStatus(res, client);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ activeRuns: [], queueLength: 0 });
    });

    it("returns live status from daemon", async () => {
      const liveStatus: WorkflowLiveStatus = {
        activeRuns: [{ runId: "run-abc", workflow: "builder", startedAt: new Date().toISOString() }],
        pendingRuns: [],
        queueLength: 1,
        completedRuns: 3,
        workflows: {},
        paused: false,
        agentConcurrency: 1,
        codeConcurrency: 4,
      };
      const client = mockTransport({ status: liveStatus });
      const { res, result } = mockResponse();
      await handleWorkflowStatus(res, client);
      expect(result.status).toBe(200);
      const body = result.body as Record<string, unknown>;
      expect(body.completedRuns).toBe(3);
      expect(body.queueLength).toBe(1);
      expect((body.activeRuns as unknown[]).length).toBe(1);
    });

    it("reflects paused state from daemon", async () => {
      const client = mockTransport({
        status: {
          activeRuns: [],
          pendingRuns: [],
          queueLength: 0,
          completedRuns: 0,
          workflows: {},
          paused: true,
          agentConcurrency: 1,
          codeConcurrency: 4,
        },
      });
      const { res, result } = mockResponse();
      await handleWorkflowStatus(res, client);
      expect((result.body as Record<string, unknown>).paused).toBe(true);
    });
  });

  describe("handleWorkflowDefinitions", () => {
    it("returns empty definitions when daemon not running (null client)", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowDefinitions(res, null);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ definitions: [] });
    });

    it("returns empty definitions when daemon unreachable (client returns null)", async () => {
      const client = mockTransport({ definitions: null });
      const { res, result } = mockResponse();
      await handleWorkflowDefinitions(res, client);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ definitions: [] });
    });

    it("returns definitions from daemon", async () => {
      const defs = [
        { name: "builder", enabled: true, stepCount: 2, triggers: [{ type: "event", event: "runtime.idle" }] },
        { name: "hourly", enabled: true, stepCount: 1, triggers: [{ type: "interval", intervalMs: 3600000 }] },
      ];
      const client = mockTransport({ definitions: { definitions: defs } });
      const { res, result } = mockResponse();
      await handleWorkflowDefinitions(res, client);
      expect(result.status).toBe(200);
      const body = result.body as { definitions: unknown[] };
      expect(body.definitions).toHaveLength(2);
    });
  });

  describe("handleWorkflowPause", () => {
    it("returns 503 when daemon not running (null client)", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowPause(res, null);
      expect(result.status).toBe(503);
    });

    it("returns 503 when daemon unreachable (client returns null)", async () => {
      const client = mockTransport({ pause: null });
      const { res, result } = mockResponse();
      await handleWorkflowPause(res, client);
      expect(result.status).toBe(503);
    });

    it("returns paused true from daemon", async () => {
      const client = mockTransport({ pause: { ok: true, paused: true } });
      const { res, result } = mockResponse();
      await handleWorkflowPause(res, client);
      expect(result.status).toBe(200);
      expect((result.body as Record<string, unknown>).paused).toBe(true);
    });

    it("passes through already flag from daemon", async () => {
      const client = mockTransport({ pause: { ok: true, paused: true, already: true } });
      const { res, result } = mockResponse();
      await handleWorkflowPause(res, client);
      expect((result.body as Record<string, unknown>).already).toBe(true);
    });
  });

  describe("handleWorkflowResume", () => {
    it("returns 503 when daemon not running (null client)", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowResume(res, null);
      expect(result.status).toBe(503);
    });

    it("returns 503 when daemon unreachable (client returns null)", async () => {
      const client = mockTransport({ resume: null });
      const { res, result } = mockResponse();
      await handleWorkflowResume(res, client);
      expect(result.status).toBe(503);
    });

    it("returns paused false from daemon", async () => {
      const client = mockTransport({ resume: { ok: true, paused: false } });
      const { res, result } = mockResponse();
      await handleWorkflowResume(res, client);
      expect(result.status).toBe(200);
      expect((result.body as Record<string, unknown>).paused).toBe(false);
    });

    it("passes through already flag from daemon", async () => {
      const client = mockTransport({ resume: { ok: true, paused: false, already: true } });
      const { res, result } = mockResponse();
      await handleWorkflowResume(res, client);
      expect((result.body as Record<string, unknown>).already).toBe(true);
    });
  });

  describe("handleWorkflowAbort", () => {
    it("returns 503 when daemon not running (null client)", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowAbort(res, null);
      expect(result.status).toBe(503);
    });

    it("returns 503 when daemon unreachable (client returns null)", async () => {
      const client = mockTransport({ abort: null });
      const { res, result } = mockResponse();
      await handleWorkflowAbort(res, client);
      expect(result.status).toBe(503);
    });

    it("returns ok and aborted count from daemon", async () => {
      const client = mockTransport({ abort: { ok: true, aborted: 2 } });
      const { res, result } = mockResponse();
      await handleWorkflowAbort(res, client);
      expect(result.status).toBe(200);
      expect((result.body as Record<string, unknown>).ok).toBe(true);
      expect((result.body as Record<string, unknown>).aborted).toBe(2);
    });
  });

  describe("handleWorkflowCancel", () => {
    it("returns 503 when daemon not running (null client)", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowCancel(res, "run-abc", null);
      expect(result.status).toBe(503);
    });

    it("returns 503 when daemon unreachable (network error)", async () => {
      const client = mockTransport({ cancel: { status: 500 } });
      // Force a network error in fetchRaw rather than a 500.
      (client.fetchRaw as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        throw new Error("network");
      });
      const { res, result } = mockResponse();
      await handleWorkflowCancel(res, "run-abc", client);
      expect(result.status).toBe(503);
    });

    it("returns 400 for invalid run ID with path traversal", async () => {
      const client = mockTransport({});
      const { res, result } = mockResponse();
      await handleWorkflowCancel(res, "../etc/passwd", client);
      expect(result.status).toBe(400);
    });

    it("returns 404 when run not found", async () => {
      const client = mockTransport({ cancel: { status: 404 } });
      const { res, result } = mockResponse();
      await handleWorkflowCancel(res, "run-abc", client);
      expect(result.status).toBe(404);
    });

    it("returns 409 when run is already active", async () => {
      const client = mockTransport({ cancel: { status: 409 } });
      const { res, result } = mockResponse();
      await handleWorkflowCancel(res, "run-abc", client);
      expect(result.status).toBe(409);
    });

    it("returns 200 ok when run is cancelled successfully", async () => {
      const client = mockTransport({ cancel: { status: 200 } });
      const { res, result } = mockResponse();
      await handleWorkflowCancel(res, "run-abc", client);
      expect(result.status).toBe(200);
      expect((result.body as Record<string, unknown>).ok).toBe(true);
    });

    it("calls cancelRun with the provided runId", async () => {
      const client = mockTransport({ cancel: { status: 200 } });
      const { res } = mockResponse();
      await handleWorkflowCancel(res, "run-xyz-123", client);
      expect(client.calls).toContainEqual({
        method: "DELETE",
        path: "/workflow/runs/run-xyz-123",
      });
    });
  });

  describe("handleWorkflowRetry", () => {
    function makeRequest(body: unknown): IncomingMessage {
      const json = JSON.stringify(body);
      const req = {
        on: (event: string, cb: (chunk?: unknown) => void) => {
          if (event === "data") cb(Buffer.from(json));
          if (event === "end") cb();
        },
      } as unknown as IncomingMessage;
      return req;
    }

    it("returns 503 when daemon not running (null client)", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowRetry(makeRequest({ runId: "run-abc" }), res, store, null);
      expect(result.status).toBe(503);
    });

    it("returns 400 for missing runId", async () => {
      const client = mockTransport({});
      const { res, result } = mockResponse();
      await handleWorkflowRetry(makeRequest({}), res, store, client);
      expect(result.status).toBe(400);
    });

    it("returns 400 for invalid runId characters", async () => {
      const client = mockTransport({});
      const { res, result } = mockResponse();
      await handleWorkflowRetry(makeRequest({ runId: "../etc/passwd" }), res, store, client);
      expect(result.status).toBe(400);
    });

    it("returns 404 when run does not exist", async () => {
      const client = mockTransport({});
      const { res, result } = mockResponse();
      await handleWorkflowRetry(makeRequest({ runId: "nonexistent" }), res, store, client);
      expect(result.status).toBe(404);
    });

    it("returns 409 for successful run", async () => {
      writeRunMetadata(runsDir, "run-success-01", "builder", "success");
      const client = mockTransport({});
      const { res, result } = mockResponse();
      await handleWorkflowRetry(makeRequest({ runId: "run-success-01" }), res, store, client);
      expect(result.status).toBe(409);
    });

    it("returns 409 for running run", async () => {
      writeRunMetadata(runsDir, "run-running-01", "builder", "running");
      const client = mockTransport({});
      const { res, result } = mockResponse();
      await handleWorkflowRetry(makeRequest({ runId: "run-running-01" }), res, store, client);
      expect(result.status).toBe(409);
    });

    it("enqueues retry for failed run and returns ok", async () => {
      writeRunMetadata(runsDir, "run-failed-01", "builder", "failed");
      const client = mockTransport({});
      const { res, result } = mockResponse();
      await handleWorkflowRetry(makeRequest({ runId: "run-failed-01" }), res, store, client);
      expect(result.status).toBe(200);
      expect((result.body as Record<string, unknown>).ok).toBe(true);
      expect((result.body as Record<string, unknown>).queued).toBe("builder");
      const state = store.readState();
      expect(state.pendingRuns).toHaveLength(1);
      expect(state.pendingRuns[0].workflowName).toBe("builder");
      expect(state.pendingRuns[0].trigger.event).toBe("retry");
    });

    it("enqueues retry for interrupted run and returns ok", async () => {
      writeRunMetadata(runsDir, "run-interrupted-01", "builder", "interrupted");
      const client = mockTransport({});
      const { res, result } = mockResponse();
      await handleWorkflowRetry(makeRequest({ runId: "run-interrupted-01" }), res, store, client);
      expect(result.status).toBe(200);
      const state = store.readState();
      expect(state.pendingRuns[0].trigger.event).toBe("retry");
      expect((state.pendingRuns[0].trigger.payload as Record<string, unknown>).retryOf).toBe("run-interrupted-01");
    });

    it("returns 409 when workflow already queued", async () => {
      writeRunMetadata(runsDir, "run-failed-02", "builder", "failed");
      const state = store.readState();
      state.pendingRuns = [{
        workflowName: "builder",
        trigger: { event: "manual", payload: {} },
        enqueuedAtMs: Date.now(),
        notBeforeMs: Date.now(),
      }];
      store.setPendingRuns(state.pendingRuns);

      const client = mockTransport({});
      const { res, result } = mockResponse();
      await handleWorkflowRetry(makeRequest({ runId: "run-failed-02" }), res, store, client);
      expect(result.status).toBe(409);
    });
  });

  describe("handleWorkflowReplay", () => {
    function makeRequest(body: unknown): IncomingMessage {
      const json = JSON.stringify(body);
      const req = {
        on: (event: string, cb: (chunk?: unknown) => void) => {
          if (event === "data") cb(Buffer.from(json));
          if (event === "end") cb();
        },
      } as unknown as IncomingMessage;
      return req;
    }

    it("returns 400 for missing runId", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowReplay(makeRequest({}), res, store);
      expect(result.status).toBe(400);
    });

    it("returns 400 for invalid runId characters", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowReplay(makeRequest({ runId: "../etc/passwd" }), res, store);
      expect(result.status).toBe(400);
    });

    it("returns 404 when run does not exist", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowReplay(makeRequest({ runId: "nonexistent" }), res, store);
      expect(result.status).toBe(404);
    });

    it("returns 409 for running run", async () => {
      writeRunMetadata(runsDir, "run-running-replay", "builder", "running");
      const { res, result } = mockResponse();
      await handleWorkflowReplay(makeRequest({ runId: "run-running-replay" }), res, store);
      expect(result.status).toBe(409);
    });

    it("enqueues replay for successful run and returns ok with runId", async () => {
      writeRunMetadata(runsDir, "run-success-replay", "builder", "success");
      const { res, result } = mockResponse();
      await handleWorkflowReplay(makeRequest({ runId: "run-success-replay" }), res, store);
      expect(result.status).toBe(200);
      expect((result.body as Record<string, unknown>).ok).toBe(true);
      expect((result.body as Record<string, unknown>).queued).toBe("builder");
      expect(typeof (result.body as Record<string, unknown>).runId).toBe("string");
      const state = store.readState();
      expect(state.pendingRuns).toHaveLength(1);
      expect(state.pendingRuns[0].workflowName).toBe("builder");
      expect(state.pendingRuns[0].trigger.event).toBe("workflow.replay");
      expect((state.pendingRuns[0].trigger.payload as Record<string, unknown>).replayOf).toBe("run-success-replay");
    });

    it("enqueues replay for failed run", async () => {
      writeRunMetadata(runsDir, "run-failed-replay", "builder", "failed");
      const { res, result } = mockResponse();
      await handleWorkflowReplay(makeRequest({ runId: "run-failed-replay" }), res, store);
      expect(result.status).toBe(200);
      const state = store.readState();
      expect(state.pendingRuns[0].trigger.event).toBe("workflow.replay");
    });

    it("returns 409 when workflow already queued", async () => {
      writeRunMetadata(runsDir, "run-success-replay2", "builder", "success");
      const state = store.readState();
      state.pendingRuns = [{
        workflowName: "builder",
        trigger: { event: "manual", payload: {} },
        enqueuedAtMs: Date.now(),
        notBeforeMs: Date.now(),
      }];
      store.setPendingRuns(state.pendingRuns);
      const { res, result } = mockResponse();
      await handleWorkflowReplay(makeRequest({ runId: "run-success-replay2" }), res, store);
      expect(result.status).toBe(409);
    });
  });

  describe("handleWorkflowTrigger", () => {
    function makeRequest(body: unknown): IncomingMessage {
      const json = JSON.stringify(body);
      const req = {
        on: (event: string, cb: (chunk?: unknown) => void) => {
          if (event === "data") cb(Buffer.from(json));
          if (event === "end") cb();
        },
      } as unknown as IncomingMessage;
      return req;
    }

    it("enqueues a workflow run and returns ok", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "builder" }), res, store);
      expect(result.status).toBe(200);
      expect((result.body as Record<string, unknown>).ok).toBe(true);
      const state = store.readState();
      expect(state.pendingRuns).toHaveLength(1);
      expect(state.pendingRuns[0].workflowName).toBe("builder");
      expect(state.pendingRuns[0].trigger.event).toBe("manual");
    });

    it("returns 400 for missing name", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({}), res, store);
      expect(result.status).toBe(400);
    });

    it("returns 400 for invalid name characters", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "../etc/passwd" }), res, store);
      expect(result.status).toBe(400);
    });

    it("returns 409 when workflow already queued", async () => {
      const state = store.readState();
      state.pendingRuns = [{
        workflowName: "builder",
        trigger: { event: "manual", payload: {} },
        enqueuedAtMs: Date.now(),
        notBeforeMs: Date.now(),
      }];
      store.setPendingRuns(state.pendingRuns);

      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "builder" }), res, store);
      expect(result.status).toBe(409);
    });

    it("routes through daemon client when available and returns ok", async () => {
      const client = mockTransport({ trigger: { ok: true, queued: "builder" } });
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "builder" }), res, store, client);
      expect(result.status).toBe(200);
      expect((result.body as Record<string, unknown>).ok).toBe(true);
      expect((result.body as Record<string, unknown>).queued).toBe("builder");
      expect(store.readState().pendingRuns).toHaveLength(0);
    });

    it("returns 409 when daemon reports already queued", async () => {
      const client = mockTransport({ trigger: { ok: false, alreadyQueued: true } });
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "builder" }), res, store, client);
      expect(result.status).toBe(409);
    });

    it("falls back to direct write when daemon network error", async () => {
      const client = mockTransport({ trigger: { throws: true } });
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "builder" }), res, store, client);
      expect(result.status).toBe(200);
      expect(store.readState().pendingRuns).toHaveLength(1);
    });

    it("falls back to direct write when no daemon client (null)", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "builder" }), res, store, null);
      expect(result.status).toBe(200);
      expect(store.readState().pendingRuns).toHaveLength(1);
    });

    it("passes tags to daemon client", async () => {
      const client = mockTransport({ trigger: { ok: true, queued: "builder" } });
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "builder", tags: ["ci", "pr-42"] }), res, store, client);
      expect(result.status).toBe(200);
      const triggerCall = client.calls.find((c) => c.path === "/workflow/trigger");
      expect(triggerCall).toBeDefined();
      const payload = triggerCall?.body as { tags?: string[] };
      expect(payload.tags).toEqual(["ci", "pr-42"]);
    });

    it("includes tags in trigger payload for offline path", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "builder", tags: ["nightly"] }), res, store, null);
      expect(result.status).toBe(200);
      const queued = store.readState().pendingRuns[0];
      expect((queued.trigger.payload as Record<string, unknown>).tags).toEqual(["nightly"]);
    });

    it("ignores invalid tags field", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "builder", tags: "not-an-array" }), res, store, null);
      expect(result.status).toBe(200);
      const queued = store.readState().pendingRuns[0];
      expect((queued.trigger.payload as Record<string, unknown>).tags).toBeUndefined();
    });

    it("merges extra payload fields into trigger payload for offline path", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "builder", payload: { taskId: "task-foo-bar", region: "us-east-1" } }), res, store, null);
      expect(result.status).toBe(200);
      const queued = store.readState().pendingRuns[0];
      const payload = queued.trigger.payload as Record<string, unknown>;
      expect(payload.taskId).toBe("task-foo-bar");
      expect(payload.region).toBe("us-east-1");
      expect(typeof payload.triggeredAt).toBe("string");
    });

    it("automatic fields override any same-named fields in extra payload", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "builder", payload: { triggeredAt: "overridden", taskId: "t1" } }), res, store, null);
      expect(result.status).toBe(200);
      const queued = store.readState().pendingRuns[0];
      const payload = queued.trigger.payload as Record<string, unknown>;
      expect(payload.triggeredAt).not.toBe("overridden");
      expect(payload.taskId).toBe("t1");
    });

    it("passes extra payload to daemon client", async () => {
      const client = mockTransport({ trigger: { ok: true, queued: "builder" } });
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "builder", payload: { taskId: "abc" } }), res, store, client);
      expect(result.status).toBe(200);
      const triggerCall = client.calls.find((c) => c.path === "/workflow/trigger");
      expect(triggerCall).toBeDefined();
      const payload = triggerCall?.body as { payload?: Record<string, unknown> };
      expect(payload.payload).toEqual({ taskId: "abc" });
    });

    it("ignores invalid payload field (non-object)", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "builder", payload: ["not", "an", "object"] }), res, store, null);
      expect(result.status).toBe(200);
      const queued = store.readState().pendingRuns[0];
      const payload = queued.trigger.payload as Record<string, unknown>;
      expect(payload.taskId).toBeUndefined();
      expect(typeof payload.triggeredAt).toBe("string");
    });
  });

  describe("handleWorkflowRuns", () => {
    it("returns empty list when no runs exist", () => {
      const { res, result } = mockResponse();
      handleWorkflowRuns(res, new URL("http://localhost/api/workflow/runs"), store);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ runs: [], limit: 20, offset: 0 });
    });

    it("returns run summaries without step data", () => {
      writeRunMetadata(runsDir, "run-001", "builder", "success");
      writeRunMetadata(runsDir, "run-002", "explorer", "failed");

      const { res, result } = mockResponse();
      handleWorkflowRuns(res, new URL("http://localhost/api/workflow/runs"), store);
      expect(result.status).toBe(200);
      const body = result.body as { runs: unknown[] };
      expect(body.runs).toHaveLength(2);
      const run = body.runs[0] as Record<string, unknown>;
      expect(run).toHaveProperty("id");
      expect(run).toHaveProperty("workflow");
      expect(run).toHaveProperty("status");
      expect(run).toHaveProperty("startedAt");
      expect(run).toHaveProperty("durationMs");
      expect(run).toHaveProperty("totalCostUsd");
      expect(run).not.toHaveProperty("steps");
    });

    it("respects limit and offset", () => {
      for (let i = 1; i <= 5; i++) {
        writeRunMetadata(runsDir, `run-00${i}`, "builder", "success");
      }

      const { res, result } = mockResponse();
      handleWorkflowRuns(
        res,
        new URL("http://localhost/api/workflow/runs?limit=2&offset=1"),
        store,
      );
      const body = result.body as { runs: unknown[]; limit: number; offset: number };
      expect(body.runs).toHaveLength(2);
      expect(body.limit).toBe(2);
      expect(body.offset).toBe(1);
    });

    it("caps limit at 200", () => {
      const { res, result } = mockResponse();
      handleWorkflowRuns(res, new URL("http://localhost/api/workflow/runs?limit=999"), store);
      const body = result.body as { limit: number };
      expect(body.limit).toBe(200);
    });

    it("returns all runs newer than since timestamp", () => {
      const now = Date.now();
      writeRunMetadata(runsDir, "2025-01-01T00-00-00-000Z-builder-old", "builder", "success", {
        startedAt: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
      });
      writeRunMetadata(runsDir, "2025-02-01T00-00-00-000Z-explorer-new", "explorer", "success", {
        startedAt: new Date(now - 1 * 60 * 60 * 1000).toISOString(),
      });

      const { res, result } = mockResponse();
      const since = now - 24 * 60 * 60 * 1000;
      handleWorkflowRuns(
        res,
        new URL(`http://localhost/api/workflow/runs?since=${since}`),
        store,
      );
      const body = result.body as { runs: { id: string }[]; since: number };
      expect(body.runs).toHaveLength(1);
      expect(body.runs[0].id).toBe("2025-02-01T00-00-00-000Z-explorer-new");
      expect(body.since).toBe(since);
    });
  });

  describe("handleWorkflowRuns causedByRunId filter", () => {
    it("returns only runs caused by the specified run ID", () => {
      const upstreamId = "2025-01-01T00-00-00-000Z-explorer-abc";
      const downstreamId1 = "2025-01-02T00-00-00-000Z-builder-def";
      const downstreamId2 = "2025-01-03T00-00-00-000Z-improver-ghi";
      const unrelatedId = "2025-01-04T00-00-00-000Z-builder-jkl";

      writeRunMetadata(runsDir, upstreamId, "explorer", "success");
      writeRunMetadata(runsDir, downstreamId1, "builder", "success", {
        causedBy: { runId: upstreamId, workflow: "explorer" },
      });
      writeRunMetadata(runsDir, downstreamId2, "improver", "success", {
        causedBy: { runId: upstreamId, workflow: "explorer" },
      });
      writeRunMetadata(runsDir, unrelatedId, "builder", "success", {
        causedBy: { runId: "some-other-run-id", workflow: "explorer" },
      });

      const { res, result } = mockResponse();
      handleWorkflowRuns(
        res,
        new URL(`http://localhost/api/workflow/runs?causedByRunId=${upstreamId}`),
        store,
      );
      expect(result.status).toBe(200);
      const body = result.body as { runs: { id: string }[] };
      expect(body.runs).toHaveLength(2);
      const ids = body.runs.map((r) => r.id);
      expect(ids).toContain(downstreamId1);
      expect(ids).toContain(downstreamId2);
      expect(ids).not.toContain(upstreamId);
      expect(ids).not.toContain(unrelatedId);
    });

    it("returns empty list when no runs match causedByRunId", () => {
      writeRunMetadata(runsDir, "2025-05-01T00-00-00-000Z-builder-xyz", "builder", "success");

      const { res, result } = mockResponse();
      handleWorkflowRuns(
        res,
        new URL("http://localhost/api/workflow/runs?causedByRunId=nonexistent-run"),
        store,
      );
      expect(result.status).toBe(200);
      const body = result.body as { runs: unknown[] };
      expect(body.runs).toHaveLength(0);
    });
  });

  describe("handleWorkflowRunDetail", () => {
    it("returns 404 for unknown run ID", () => {
      const { res, result } = mockResponse();
      handleWorkflowRunDetail(res, "nonexistent-run", store);
      expect(result.status).toBe(404);
    });

    it("returns 400 for path traversal attempt", () => {
      const { res, result } = mockResponse();
      handleWorkflowRunDetail(res, "../etc/passwd", store);
      expect(result.status).toBe(400);
    });

    it("returns full metadata including steps", () => {
      writeRunMetadata(runsDir, "run-detail-001", "builder", "success");

      const { res, result } = mockResponse();
      handleWorkflowRunDetail(res, "run-detail-001", store);
      expect(result.status).toBe(200);
      const body = result.body as Record<string, unknown>;
      expect(body.id).toBe("run-detail-001");
      expect(body.workflow).toBe("builder");
      expect(Array.isArray(body.steps)).toBe(true);
    });

    it("includes workflowSteps from workflow.json when present", () => {
      writeRunMetadata(runsDir, "run-detail-002", "builder", "success");
      writeFileSync(
        join(runsDir, "run-detail-002", "workflow.json"),
        JSON.stringify({
          name: "builder",
          steps: [
            { id: "inspect-queue", type: "code" },
            { id: "build", type: "agent" },
          ],
        }),
      );

      const { res, result } = mockResponse();
      handleWorkflowRunDetail(res, "run-detail-002", store);
      expect(result.status).toBe(200);
      const body = result.body as Record<string, unknown>;
      expect(Array.isArray(body.workflowSteps)).toBe(true);
      const ws = body.workflowSteps as Array<{ id: string; type: string }>;
      expect(ws).toHaveLength(2);
      expect(ws[0]).toEqual({ id: "inspect-queue", type: "code" });
      expect(ws[1]).toEqual({ id: "build", type: "agent" });
    });

    it("omits workflowSteps when workflow.json is absent", () => {
      writeRunMetadata(runsDir, "run-detail-003", "builder", "success");

      const { res, result } = mockResponse();
      handleWorkflowRunDetail(res, "run-detail-003", store);
      expect(result.status).toBe(200);
      const body = result.body as Record<string, unknown>;
      expect(body.workflowSteps).toBeUndefined();
    });
  });

  describe("handleWorkflowRunStream", () => {
    it("returns 400 for path traversal attempt", () => {
      const { res, result } = mockResponse();
      handleWorkflowRunStream(res, "../etc/passwd", store);
      expect(result.status).toBe(400);
    });

    it("returns 404 for unknown run ID", () => {
      const { res, result } = mockResponse();
      handleWorkflowRunStream(res, "nonexistent-run", store);
      expect(result.status).toBe(404);
    });

    it("returns 404 for completed run", () => {
      writeRunMetadata(runsDir, "run-done-001", "builder", "success");
      const { res, result } = mockResponse();
      handleWorkflowRunStream(res, "run-done-001", store);
      expect(result.status).toBe(404);
      expect((result.body as Record<string, unknown>).error).toMatch(/not active/);
    });
  });

  describe("listRunMetadata", () => {
    it("returns runs sorted newest first", () => {
      writeRunMetadata(runsDir, "2025-01-01-run-aaa", "builder", "success");
      writeRunMetadata(runsDir, "2025-02-01-run-bbb", "explorer", "success");
      writeRunMetadata(runsDir, "2025-03-01-run-ccc", "builder", "failed");

      const runs = listRunMetadata(store, 10, 0);
      expect(runs).toHaveLength(3);
      expect(runs[0].id).toBe("2025-03-01-run-ccc");
      expect(runs[2].id).toBe("2025-01-01-run-aaa");
    });

    it("returns empty array when runs dir is missing", () => {
      rmSync(join(projectDir, ".kota", "runs"), { recursive: true });
      const runs = listRunMetadata(store, 10, 0);
      expect(runs).toEqual([]);
    });
  });

  describe("handleWorkflowRunArtifacts", () => {
    it("returns 400 for path traversal attempt", () => {
      const { res, result } = mockResponse();
      handleWorkflowRunArtifacts(res, "../etc/passwd", store);
      expect(result.status).toBe(400);
    });

    it("returns 404 for unknown run ID", () => {
      const { res, result } = mockResponse();
      handleWorkflowRunArtifacts(res, "nonexistent-run", store);
      expect(result.status).toBe(404);
    });

    it("returns null fields when no artifact files exist", () => {
      writeRunMetadata(runsDir, "run-artifacts-001", "builder", "success");
      const { res, result } = mockResponse();
      handleWorkflowRunArtifacts(res, "run-artifacts-001", store);
      expect(result.status).toBe(200);
      const body = result.body as Record<string, unknown>;
      expect(body.runSummary).toBeNull();
      expect(body.commitMessage).toBeNull();
      expect(body.textFiles).toEqual([]);
    });

    it("returns parsed run-summary.json when present", () => {
      writeRunMetadata(runsDir, "run-artifacts-002", "builder", "success");
      const summary = {
        runId: "run-artifacts-002",
        workflow: "builder",
        taskId: "task-foo",
        taskTitle: "Foo task",
        outcome: "success",
        commitSha: "abc123def456",
        commitMessage: "Fix foo",
        filesChanged: ["src/foo.ts"],
        costUsd: 0.05,
        durationMs: 1000,
        completedAt: new Date().toISOString(),
      };
      writeFileSync(join(runsDir, "run-artifacts-002", "run-summary.json"), JSON.stringify(summary));
      const { res, result } = mockResponse();
      handleWorkflowRunArtifacts(res, "run-artifacts-002", store);
      expect(result.status).toBe(200);
      const body = result.body as Record<string, unknown>;
      expect(body.runSummary).toMatchObject({ taskId: "task-foo", commitSha: "abc123def456" });
    });

    it("returns commit-message.txt content when present", () => {
      writeRunMetadata(runsDir, "run-artifacts-003", "builder", "success");
      writeFileSync(join(runsDir, "run-artifacts-003", "commit-message.txt"), "My commit\n\nDetails here");
      const { res, result } = mockResponse();
      handleWorkflowRunArtifacts(res, "run-artifacts-003", store);
      expect(result.status).toBe(200);
      const body = result.body as Record<string, unknown>;
      expect(body.commitMessage).toBe("My commit\n\nDetails here");
    });

    it("lists other .txt and .md artifact files", () => {
      writeRunMetadata(runsDir, "run-artifacts-004", "builder", "success");
      writeFileSync(join(runsDir, "run-artifacts-004", "notes.md"), "# Notes\n\nSome notes");
      const { res, result } = mockResponse();
      handleWorkflowRunArtifacts(res, "run-artifacts-004", store);
      expect(result.status).toBe(200);
      const body = result.body as Record<string, unknown>;
      const files = body.textFiles as Array<{ name: string; content: string }>;
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe("notes.md");
      expect(files[0].content).toContain("Some notes");
    });
  });
});
