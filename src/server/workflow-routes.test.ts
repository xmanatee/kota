import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowLiveStatus } from "../scheduler/daemon-control.js";
import { WorkflowRunStore } from "../workflow/run-store.js";
import type { DaemonControlClient } from "./daemon-client.js";
import {
  handleWorkflowAbort,
  handleWorkflowPause,
  handleWorkflowResume,
  handleWorkflowStatus,
  handleWorkflowTrigger,
} from "./workflow-routes.js";
import {
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
    definitionPath: `src/workflows/${workflow}/workflow.ts`,
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

function mockClient(overrides: Partial<{
  getWorkflowStatus: () => Promise<WorkflowLiveStatus | null>;
  pause: () => Promise<{ ok: boolean; paused: boolean; already?: boolean } | null>;
  resume: () => Promise<{ ok: boolean; paused: boolean; already?: boolean } | null>;
  abort: () => Promise<{ ok: boolean; aborted: number } | null>;
  trigger: (name: string) => Promise<{ ok: boolean; queued?: string; alreadyQueued?: boolean } | null>;
}>): DaemonControlClient {
  return {
    getWorkflowStatus: vi.fn().mockResolvedValue({
      activeRuns: [],
      queueLength: 0,
      completedRuns: 0,
      workflows: {},
      paused: false,
    }),
    pause: vi.fn().mockResolvedValue({ ok: true, paused: true }),
    resume: vi.fn().mockResolvedValue({ ok: true, paused: false }),
    abort: vi.fn().mockResolvedValue({ ok: true, aborted: 0 }),
    trigger: vi.fn().mockResolvedValue(null),
    getDaemonStatus: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as DaemonControlClient;
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
      const client = mockClient({ getWorkflowStatus: async () => null });
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
      };
      const client = mockClient({ getWorkflowStatus: async () => liveStatus });
      const { res, result } = mockResponse();
      await handleWorkflowStatus(res, client);
      expect(result.status).toBe(200);
      const body = result.body as Record<string, unknown>;
      expect(body.completedRuns).toBe(3);
      expect(body.queueLength).toBe(1);
      expect((body.activeRuns as unknown[]).length).toBe(1);
    });

    it("reflects paused state from daemon", async () => {
      const client = mockClient({
        getWorkflowStatus: async () => ({
          activeRuns: [],
          pendingRuns: [],
          queueLength: 0,
          completedRuns: 0,
          workflows: {},
          paused: true,
        }),
      });
      const { res, result } = mockResponse();
      await handleWorkflowStatus(res, client);
      expect((result.body as Record<string, unknown>).paused).toBe(true);
    });
  });

  describe("handleWorkflowPause", () => {
    it("returns 503 when daemon not running (null client)", async () => {
      const { res, result } = mockResponse();
      await handleWorkflowPause(res, null);
      expect(result.status).toBe(503);
    });

    it("returns 503 when daemon unreachable (client returns null)", async () => {
      const client = mockClient({ pause: async () => null });
      const { res, result } = mockResponse();
      await handleWorkflowPause(res, client);
      expect(result.status).toBe(503);
    });

    it("returns paused true from daemon", async () => {
      const client = mockClient({ pause: async () => ({ ok: true, paused: true }) });
      const { res, result } = mockResponse();
      await handleWorkflowPause(res, client);
      expect(result.status).toBe(200);
      expect((result.body as Record<string, unknown>).paused).toBe(true);
    });

    it("passes through already flag from daemon", async () => {
      const client = mockClient({ pause: async () => ({ ok: true, paused: true, already: true }) });
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
      const client = mockClient({ resume: async () => null });
      const { res, result } = mockResponse();
      await handleWorkflowResume(res, client);
      expect(result.status).toBe(503);
    });

    it("returns paused false from daemon", async () => {
      const client = mockClient({ resume: async () => ({ ok: true, paused: false }) });
      const { res, result } = mockResponse();
      await handleWorkflowResume(res, client);
      expect(result.status).toBe(200);
      expect((result.body as Record<string, unknown>).paused).toBe(false);
    });

    it("passes through already flag from daemon", async () => {
      const client = mockClient({ resume: async () => ({ ok: true, paused: false, already: true }) });
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
      const client = mockClient({ abort: async () => null });
      const { res, result } = mockResponse();
      await handleWorkflowAbort(res, client);
      expect(result.status).toBe(503);
    });

    it("returns ok and aborted count from daemon", async () => {
      const client = mockClient({ abort: async () => ({ ok: true, aborted: 2 }) });
      const { res, result } = mockResponse();
      await handleWorkflowAbort(res, client);
      expect(result.status).toBe(200);
      expect((result.body as Record<string, unknown>).ok).toBe(true);
      expect((result.body as Record<string, unknown>).aborted).toBe(2);
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
      const client = mockClient({ trigger: async () => ({ ok: true, queued: "builder" }) });
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "builder" }), res, store, client);
      expect(result.status).toBe(200);
      expect((result.body as Record<string, unknown>).ok).toBe(true);
      expect((result.body as Record<string, unknown>).queued).toBe("builder");
      expect(store.readState().pendingRuns).toHaveLength(0);
    });

    it("returns 409 when daemon reports already queued", async () => {
      const client = mockClient({ trigger: async () => ({ ok: false, alreadyQueued: true }) });
      const { res, result } = mockResponse();
      await handleWorkflowTrigger(makeRequest({ name: "builder" }), res, store, client);
      expect(result.status).toBe(409);
    });

    it("falls back to direct write when daemon client returns null", async () => {
      const client = mockClient({ trigger: async () => null });
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
});
