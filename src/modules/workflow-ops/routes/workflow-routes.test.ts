import { appendFileSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaAgentMessage } from "#core/agent-harness/index.js";
import type { WorkflowLiveStatus, WorkflowRunDetail } from "#core/daemon/daemon-control.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { writeWriterIntegrationFixture } from "#core/workflow/testing/writer-integration-fixture.js";
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
  handleWorkflowRunThinking,
  listRunMetadata,
} from "./workflow-run-routes.js";

function makeScopeRoot(): string {
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
    trigger: { event: "runtime.idle", schemaRef: null, payload: {} },
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

function runDetail(
  id: string,
  status: WorkflowRunDetail["status"],
  overrides: Partial<WorkflowRunDetail> = {},
): WorkflowRunDetail {
  return {
    id,
    workflow: "builder",
    status,
    triggerEvent: "runtime.idle",
    triggerSchemaRef: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    steps: [],
    ...overrides,
  };
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

type ParsedSseEvent = { event: string; data: Record<string, unknown> };

function mockSseResponse() {
  const handlers = new Map<string, Array<() => void>>();
  const chunks: string[] = [];
  const result = { status: 0, ended: false };
  const res = {
    setHeader: vi.fn(),
    writeHead: vi.fn((status: number) => {
      result.status = status;
    }),
    write: vi.fn((chunk: string) => {
      chunks.push(chunk);
      return true;
    }),
    end: vi.fn(() => {
      result.ended = true;
    }),
    on: vi.fn((event: string, handler: () => void) => {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
      return res;
    }),
  } as unknown as ServerResponse;

  return {
    res,
    result,
    chunks,
    close: () => {
      for (const handler of handlers.get("close") ?? []) handler();
    },
  };
}

function parseSseEvents(chunks: string[]): ParsedSseEvent[] {
  return chunks
    .join("")
    .split("\n\n")
    .filter((part) => part.trim())
    .map((part) => {
      const lines = part.split("\n");
      const event = lines.find((l) => l.startsWith("event: "))?.slice("event: ".length);
      const data = lines.find((l) => l.startsWith("data: "))?.slice("data: ".length);
      if (!event || !data) throw new Error(`Invalid SSE chunk: ${part}`);
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}

type MockTransportSpec = Partial<{
  status: WorkflowLiveStatus | null;
  definitions: { definitions: unknown[] } | null;
  pause: { ok: boolean; paused: boolean; already?: boolean } | null;
  resume: { ok: boolean; paused: boolean; already?: boolean } | null;
  abort: { ok: boolean; aborted: number } | null;
  /** Trigger response. Use `{ throws: true }` to simulate a network error. */
  trigger:
    | { ok: true; queued: string; runId?: string }
    | { ok: false; alreadyQueued: true }
    | { status: number; body: unknown }
    | { throws: true }
    | null;
  runs: Record<string, WorkflowRunDetail>;
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
          concurrency: 4,
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
      if (path.startsWith("/workflow/runs/") && method === "GET") {
        const id = decodeURIComponent(path.slice("/workflow/runs/".length).split("?", 1)[0]!);
        const run = spec.runs?.[id];
        return run === undefined
          ? makeFakeResponse(404, { error: `Run "${id}" not found` })
          : makeFakeResponse(200, run);
      }
      if (path.startsWith("/workflow/trigger") && method === "POST") {
        const t = spec.trigger;
        if (t == null) return makeFakeResponse(503, { error: "Daemon not reachable" });
        if ("throws" in t) throw new Error("network");
        if ("status" in t) return makeFakeResponse(t.status, t.body);
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
  let workspaceRoot: string;
  let store: WorkflowRunStore;
  let runsDir: string;

  beforeEach(() => {
    workspaceRoot = makeScopeRoot();
    store = new WorkflowRunStore(workspaceRoot);
    runsDir = join(workspaceRoot, ".kota", "runs");
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(workspaceRoot, { recursive: true, force: true });
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
        concurrency: 4,
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
          concurrency: 4,
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
    function makeRequest(body: unknown, url = "/api/workflow/retry"): IncomingMessage {
      const json = JSON.stringify(body);
      const req = {
        url,
        on: (event: string, cb: (chunk?: unknown) => void) => {
          if (event === "data") cb(Buffer.from(json));
          if (event === "end") cb();
        },
      } as unknown as IncomingMessage;
      return req;
    }

    it("returns 503 when daemon not running (null client)", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowRetry(makeRequest({ runId: "run-abc" }), res, null);
      expect(result.status).toBe(503);
    });

    it("returns 400 for missing runId", async () => {
      const client = mockTransport({});
      const { res, result } = mockResponse();
      await handleWorkflowRetry(makeRequest({}), res, client);
      expect(result.status).toBe(400);
    });

    it("returns 400 for invalid runId characters", async () => {
      const client = mockTransport({});
      const { res, result } = mockResponse();
      await handleWorkflowRetry(makeRequest({ runId: "../etc/passwd" }), res, client);
      expect(result.status).toBe(400);
    });

    it("returns 404 when run does not exist", async () => {
      const client = mockTransport({});
      const { res, result } = mockResponse();
      await handleWorkflowRetry(makeRequest({ runId: "nonexistent" }), res, client);
      expect(result.status).toBe(404);
    });

    it("returns 409 for successful run", async () => {
      const client = mockTransport({ runs: { "run-success-01": runDetail("run-success-01", "success") } });
      const { res, result } = mockResponse();
      await handleWorkflowRetry(makeRequest({ runId: "run-success-01" }), res, client);
      expect(result.status).toBe(409);
    });

    it("returns 409 for running run", async () => {
      const client = mockTransport({ runs: { "run-running-01": runDetail("run-running-01", "running") } });
      const { res, result } = mockResponse();
      await handleWorkflowRetry(makeRequest({ runId: "run-running-01" }), res, client);
      expect(result.status).toBe(409);
    });

    it("retries with the original trigger semantics through the daemon", async () => {
      const client = mockTransport({
        runs: {
          "run-failed-01": runDetail("run-failed-01", "failed", {
            triggerEvent: "autonomy.builder.recovery.requested",
            triggerSchemaRef: { name: "builder-recovery", version: 1 },
            triggerPayload: {
              taskId: "task-ui",
              _runId: "run-failed-01",
              triggeredAt: "old",
              replayOf: "older-run",
            },
          }),
        },
        trigger: { ok: true, queued: "builder", runId: "run-retry" },
      });
      const { res, result } = mockResponse();
      await handleWorkflowRetry(
        makeRequest({ runId: "run-failed-01" }, "/api/workflow/retry?scopeId=scope-a"),
        res,
        client,
      );
      expect(result.status).toBe(200);
      expect(client.calls).toContainEqual(expect.objectContaining({
        method: "POST",
        path: "/workflow/trigger?scopeId=scope-a",
        body: expect.objectContaining({
          name: "builder",
          event: "autonomy.builder.recovery.requested",
          schemaRef: { name: "builder-recovery", version: 1 },
          payload: { taskId: "task-ui", retryOf: "run-failed-01" },
        }),
      }));
    });

    it("retries interrupted runs", async () => {
      const client = mockTransport({
        runs: { "run-interrupted-01": runDetail("run-interrupted-01", "interrupted") },
        trigger: { ok: true, queued: "builder" },
      });
      const { res, result } = mockResponse();
      await handleWorkflowRetry(makeRequest({ runId: "run-interrupted-01" }), res, client);
      expect(result.status).toBe(200);
      expect(client.calls[1]?.body).toMatchObject({
        event: "runtime.idle",
        payload: { retryOf: "run-interrupted-01" },
      });
    });

    it("returns the daemon conflict when workflow is already queued", async () => {
      const client = mockTransport({
        runs: { "run-failed-02": runDetail("run-failed-02", "failed") },
        trigger: { ok: false, alreadyQueued: true },
      });
      const { res, result } = mockResponse();
      await handleWorkflowRetry(makeRequest({ runId: "run-failed-02" }), res, client);
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

    it("returns 503 when daemon is not running", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowReplay(makeRequest({ runId: "run-success" }), res, null);
      expect(result.status).toBe(503);
    });

    it("returns 400 for missing runId", async () => {
      const client = mockTransport({});
      const { res, result } = mockResponse();
      await handleWorkflowReplay(makeRequest({}), res, client);
      expect(result.status).toBe(400);
    });

    it("returns 400 for invalid runId characters", async () => {
      const client = mockTransport({});
      const { res, result } = mockResponse();
      await handleWorkflowReplay(makeRequest({ runId: "../etc/passwd" }), res, client);
      expect(result.status).toBe(400);
    });

    it("returns 404 when run does not exist", async () => {
      const client = mockTransport({});
      const { res, result } = mockResponse();
      await handleWorkflowReplay(makeRequest({ runId: "nonexistent" }), res, client);
      expect(result.status).toBe(404);
    });

    it("returns 409 for running run", async () => {
      const client = mockTransport({
        runs: { "run-running-replay": runDetail("run-running-replay", "running") },
      });
      const { res, result } = mockResponse();
      await handleWorkflowReplay(makeRequest({ runId: "run-running-replay" }), res, client);
      expect(result.status).toBe(409);
    });

    it("replays the original trigger through the daemon", async () => {
      const client = mockTransport({
        runs: {
          "run-success-replay": runDetail("run-success-replay", "success", {
            triggerEvent: "autonomy.builder.recovery.requested",
            triggerPayload: { taskId: "task-ui", _runId: "old", retryOf: "older" },
          }),
        },
        trigger: { ok: true, queued: "builder", runId: "run-replay" },
      });
      const { res, result } = mockResponse();
      await handleWorkflowReplay(makeRequest({ runId: "run-success-replay" }), res, client);
      expect(result.status).toBe(200);
      expect(client.calls[1]?.body).toMatchObject({
        event: "autonomy.builder.recovery.requested",
        payload: { taskId: "task-ui", replayOf: "run-success-replay" },
      });
    });

    it("replays failed runs", async () => {
      const client = mockTransport({
        runs: { "run-failed-replay": runDetail("run-failed-replay", "failed") },
        trigger: { ok: true, queued: "builder" },
      });
      const { res, result } = mockResponse();
      await handleWorkflowReplay(makeRequest({ runId: "run-failed-replay" }), res, client);
      expect(result.status).toBe(200);
    });

    it("returns the daemon conflict when workflow is already queued", async () => {
      const client = mockTransport({
        runs: { "run-success-replay2": runDetail("run-success-replay2", "success") },
        trigger: { ok: false, alreadyQueued: true },
      });
      const { res, result } = mockResponse();
      await handleWorkflowReplay(makeRequest({ runId: "run-success-replay2" }), res, client);
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

    it("returns 503 without a daemon", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "builder" }), res, null);
      expect(result.status).toBe(503);
    });

    it("preserves daemon validation responses", async () => {
      const client = mockTransport({
        trigger: { status: 400, body: { error: "tags must be an array of strings" } },
      });
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "builder", tags: "invalid" }), res, client);
      expect(result.status).toBe(400);
      expect(result.body).toEqual({ error: "tags must be an array of strings" });
    });

    it("returns 409 when workflow already queued", async () => {
      const client = mockTransport({ trigger: { ok: false, alreadyQueued: true } });
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "builder" }), res, client);
      expect(result.status).toBe(409);
    });

    it("routes through daemon client when available and returns ok", async () => {
      const client = mockTransport({ trigger: { ok: true, queued: "builder" } });
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "builder" }), res, client);
      expect(result.status).toBe(200);
      expect((result.body as Record<string, unknown>).ok).toBe(true);
      expect((result.body as Record<string, unknown>).queued).toBe("builder");
    });

    it("returns 503 on daemon network error", async () => {
      const client = mockTransport({ trigger: { throws: true } });
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "builder" }), res, client);
      expect(result.status).toBe(503);
    });

    it("passes tags to daemon client", async () => {
      const client = mockTransport({ trigger: { ok: true, queued: "builder" } });
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "builder", tags: ["ci", "pr-42"] }), res, client);
      expect(result.status).toBe(200);
      const triggerCall = client.calls.find((c) => c.path === "/workflow/trigger");
      expect(triggerCall).toBeDefined();
      const payload = triggerCall?.body as { tags?: string[] };
      expect(payload.tags).toEqual(["ci", "pr-42"]);
    });

    it("passes extra payload to daemon client", async () => {
      const client = mockTransport({ trigger: { ok: true, queued: "builder" } });
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "builder", payload: { taskId: "abc" } }), res, client);
      expect(result.status).toBe(200);
      const triggerCall = client.calls.find((c) => c.path === "/workflow/trigger");
      expect(triggerCall).toBeDefined();
      const payload = triggerCall?.body as { payload?: Record<string, unknown> };
      expect(payload.payload).toEqual({ taskId: "abc" });
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

    it("returns metadata with redacted step output and provenance", () => {
      writeRunMetadata(runsDir, "run-detail-001", "builder", "success", {
        steps: [
          {
            id: "build",
            type: "agent",
            status: "success",
            startedAt: new Date(1700000000000).toISOString(),
            completedAt: new Date(1700000001000).toISOString(),
            durationMs: 1000,
            output: { raw: "RAW_TOOL_OUTPUT", ok: true },
          },
        ],
      });

      const { res, result } = mockResponse();
      handleWorkflowRunDetail(res, "run-detail-001", store);
      expect(result.status).toBe(200);
      const body = result.body as Record<string, unknown>;
      expect(body.id).toBe("run-detail-001");
      expect(body.workflow).toBe("builder");
      expect(Array.isArray(body.steps)).toBe(true);
      expect(body.provenance).toMatchObject({
        workflowName: "builder",
        runId: "run-detail-001",
      });
      const steps = body.steps as Array<{ output: { redacted: true; reason: string } }>;
      expect(steps[0].output).toMatchObject({
        redacted: true,
        reason: "tool-io",
      });
      expect(JSON.stringify(body)).not.toContain("RAW_TOOL_OUTPUT");
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

    it("scopes active KotaAgentMessage JSONL frames into typed SSE events", () => {
      vi.useFakeTimers();
      const runId = "run-active-typed-001";
      const stepId = "build";
      writeRunMetadata(runsDir, runId, "builder", "running", {
        completedAt: undefined,
        durationMs: undefined,
        totalCostUsd: undefined,
        steps: [],
      });
      mkdirSync(join(runsDir, runId, "steps"), { recursive: true });
      const messages: KotaAgentMessage[] = [
        { type: "text", text: "Agent says hello", sessionId: "session-1" },
        { type: "thinking", thinking: "private reasoning", sessionId: "session-1" },
        {
          type: "tool_call",
          toolUseId: "tool-1",
          toolName: "Read",
          input: { path: "README.md" },
          sessionId: "session-1",
        },
        {
          type: "tool_result",
          toolUseId: "tool-1",
          isError: false,
          content: "file contents",
          sessionId: "session-1",
        },
        {
          type: "status",
          category: "auth_status",
          text: "logged in",
          sessionId: "session-1",
        },
        {
          type: "result",
          isError: false,
          subtype: "success",
          numTurns: 2,
          totalCostUsd: 0.01,
          text: "Done",
          sessionId: "session-1",
        },
        { type: "raw", adapter: "raw-adapter", payload: { provider: "opaque" } },
      ];
      writeFileSync(
        join(runsDir, runId, "steps", `${stepId}.events.jsonl`),
        `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
        "utf-8",
      );

      const sse = mockSseResponse();
      try {
        handleWorkflowRunStream(sse.res, runId, store);
        expect(sse.result.status).toBe(200);

        let events = parseSseEvents(sse.chunks);
        expect(events.map((event) => event.event)).toEqual([
          "step_started",
          "step_output",
          "step_thinking",
          "step_tool",
          "step_tool_result",
          "step_status",
          "step_result",
        ]);
        expect(events.find((event) => event.event === "step_output")?.data).toMatchObject({
          stepId,
          messageType: "text",
          text: {
            redacted: true,
            reason: "provider-payload",
          },
          sessionId: "session-1",
        });
        expect(events.find((event) => event.event === "step_thinking")?.data).toMatchObject({
          stepId,
          messageType: "thinking",
          thinking: {
            redacted: true,
            reason: "private-reasoning",
          },
        });
        expect(events.find((event) => event.event === "step_tool")?.data).toMatchObject({
          stepId,
          messageType: "tool_call",
          tool: "Read",
          toolUseId: "tool-1",
          input: {
            redacted: true,
            reason: "tool-io",
          },
        });
        expect(events.find((event) => event.event === "step_tool_result")?.data).toMatchObject({
          stepId,
          messageType: "tool_result",
          toolUseId: "tool-1",
          isError: false,
          content: {
            redacted: true,
            reason: "tool-io",
          },
        });
        expect(events.find((event) => event.event === "step_status")?.data).toMatchObject({
          stepId,
          messageType: "status",
          category: "auth_status",
          text: {
            redacted: true,
            reason: "provider-payload",
          },
        });
        expect(events.find((event) => event.event === "step_result")?.data).toMatchObject({
          stepId,
          messageType: "result",
          isError: false,
          subtype: "success",
          numTurns: 2,
          totalCostUsd: 0.01,
          text: {
            redacted: true,
            reason: "provider-payload",
          },
        });
        expect(JSON.stringify(events)).not.toContain("raw-adapter");
        expect(JSON.stringify(events)).not.toContain("Agent says hello");
        expect(JSON.stringify(events)).not.toContain("logged in");
        expect(JSON.stringify(events)).not.toContain("Done");
        expect(JSON.stringify(events)).not.toContain("private reasoning");
        expect(JSON.stringify(events)).not.toContain("file contents");

        vi.advanceTimersByTime(500);
        events = parseSseEvents(sse.chunks);
        expect(events.filter((event) => event.event === "step_output")).toHaveLength(1);

        writeRunMetadata(runsDir, runId, "builder", "success", {
          totalCostUsd: 0.01,
          steps: [
            {
              id: stepId,
              type: "agent",
              status: "success",
              startedAt: new Date(1700000000000).toISOString(),
              completedAt: new Date(1700000001000).toISOString(),
              durationMs: 1000,
              output: { ok: true },
            },
          ],
        });
        vi.advanceTimersByTime(500);

        events = parseSseEvents(sse.chunks);
        expect(events.find((event) => event.event === "step_completed")?.data).toMatchObject({
          stepId,
          status: "success",
          durationMs: 1000,
          output: {
            redacted: true,
            reason: "tool-io",
          },
        });
        expect(events.find((event) => event.event === "run_completed")?.data).toMatchObject({
          status: "success",
          durationMs: 1000,
          totalCostUsd: 0.01,
        });
        expect(sse.result.ended).toBe(true);
      } finally {
        sse.close();
      }
    });

    it("waits for partial JSONL lines and skips malformed lines without crashing", () => {
      vi.useFakeTimers();
      const runId = "run-active-partial-001";
      const stepId = "build";
      writeRunMetadata(runsDir, runId, "builder", "running", {
        completedAt: undefined,
        durationMs: undefined,
        totalCostUsd: undefined,
        steps: [],
      });
      mkdirSync(join(runsDir, runId, "steps"), { recursive: true });
      const eventsPath = join(runsDir, runId, "steps", `${stepId}.events.jsonl`);
      writeFileSync(
        eventsPath,
        `${JSON.stringify({ type: "text", text: "first" } satisfies KotaAgentMessage)}\nnot-json\n{"type":"text","text":"sec`,
        "utf-8",
      );

      const sse = mockSseResponse();
      try {
        handleWorkflowRunStream(sse.res, runId, store);
        let events = parseSseEvents(sse.chunks);
        expect(events.filter((event) => event.event === "step_output")).toHaveLength(1);
        expect(JSON.stringify(events)).not.toContain("first");

        appendFileSync(eventsPath, `ond"}\n`, "utf-8");
        vi.advanceTimersByTime(500);
        events = parseSseEvents(sse.chunks);
        expect(events.filter((event) => event.event === "step_output")).toHaveLength(2);
        expect(JSON.stringify(events)).not.toContain("second");

        vi.advanceTimersByTime(500);
        events = parseSseEvents(sse.chunks);
        expect(events.filter((event) => event.event === "step_output")).toHaveLength(2);
      } finally {
        sse.close();
      }
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
      rmSync(join(workspaceRoot, ".kota", "runs"), { recursive: true });
      const runs = listRunMetadata(store, 10, 0);
      expect(runs).toEqual([]);
    });
  });

  describe("handleWorkflowRunThinking", () => {
    it("returns redaction markers instead of private reasoning text", () => {
      const runId = "run-thinking-001";
      writeRunMetadata(runsDir, runId, "builder", "success", {
        steps: [
          {
            id: "build",
            type: "agent",
            status: "success",
            startedAt: new Date(1700000000000).toISOString(),
            completedAt: new Date(1700000001000).toISOString(),
            durationMs: 1000,
          },
        ],
      });
      mkdirSync(join(runsDir, runId, "steps"), { recursive: true });
      writeFileSync(
        join(runsDir, runId, "steps", "build.events.jsonl"),
        `${JSON.stringify({ type: "thinking", thinking: "private reasoning", sessionId: "session-1" })}\n`,
        "utf-8",
      );

      const { res, result } = mockResponse();
      handleWorkflowRunThinking(res, runId, store);

      expect(result.status).toBe(200);
      const body = result.body as {
        thinking: Record<string, Array<{ redacted: true; reason: string; bytes: number }>>;
      };
      expect(body.thinking.build[0]).toMatchObject({
        redacted: true,
        reason: "private-reasoning",
      });
      expect(JSON.stringify(body)).not.toContain("private reasoning");
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
      expect(body.writerIntegration).toBeNull();
      expect(body.commitMessage).toBeNull();
      expect(body.textFiles).toEqual([]);
    });

    it("returns projected writer integration evidence when present", () => {
      writeRunMetadata(runsDir, "run-artifacts-002", "builder", "success");
      writeWriterIntegrationFixture(runsDir, {
        runId: "run-artifacts-002",
        workflow: "builder",
        publishedHead: "abc123def456",
        commitSubject: "Fix foo",
        commitMessage: "Fix foo",
        changedPaths: ["src/foo.ts"],
      });
      const { res, result } = mockResponse();
      handleWorkflowRunArtifacts(res, "run-artifacts-002", store);
      expect(result.status).toBe(200);
      const body = result.body as Record<string, unknown>;
      expect(body.writerIntegration).toMatchObject({ publishedHead: "abc123def456" });
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

    it("lists other .txt and .md artifact files with sanitized content", () => {
      writeRunMetadata(runsDir, "run-artifacts-004", "builder", "success");
      writeFileSync(
        join(runsDir, "run-artifacts-004", "notes.md"),
        "# Notes\n\nSome notes\nsecret=raw-token",
      );
      const { res, result } = mockResponse();
      handleWorkflowRunArtifacts(res, "run-artifacts-004", store);
      expect(result.status).toBe(200);
      const body = result.body as Record<string, unknown>;
      const files = body.textFiles as Array<{ name: string; content: string }>;
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe("notes.md");
      expect(files[0].content).toContain("Some notes");
      expect(files[0].content).toContain("secret=[redacted]");
      expect(JSON.stringify(body)).not.toContain("raw-token");
    });

    it("returns an explicit error when commit-message.txt is unreadable", () => {
      writeRunMetadata(runsDir, "run-artifacts-005", "builder", "success");
      symlinkSync(
        join(runsDir, "missing-commit-message.txt"),
        join(runsDir, "run-artifacts-005", "commit-message.txt"),
      );

      const { res, result } = mockResponse();
      handleWorkflowRunArtifacts(res, "run-artifacts-005", store);

      expect(result.status).toBe(500);
      expect(result.body).toMatchObject({
        error: "Run artifact is unreadable",
        artifact: "commit-message.txt",
      });
    });

    it("returns an explicit error when a listed text artifact is unreadable", () => {
      writeRunMetadata(runsDir, "run-artifacts-006", "builder", "success");
      symlinkSync(
        join(runsDir, "missing-notes.md"),
        join(runsDir, "run-artifacts-006", "notes.md"),
      );

      const { res, result } = mockResponse();
      handleWorkflowRunArtifacts(res, "run-artifacts-006", store);

      expect(result.status).toBe(500);
      expect(result.body).toMatchObject({
        error: "Run artifact is unreadable",
        artifact: "notes.md",
      });
    });
  });
});
