/**
 * Exercises the tracing module's daemon-control routes through the same
 * registration seam the real daemon uses: `tracingControlRoutes()` is the
 * module's contribution, so the test mounts those handlers on a live
 * `DaemonControlServer` and hits `GET /metrics` via HTTP.
 *
 * Covers the wire contract migrated out of core: bearer-token auth, the
 * `read` capability scope, the Prometheus text-format `Content-Type`
 * (`text/plain; version=0.0.4; charset=utf-8`), the full per-metric
 * help/type lines, per-workflow run counts, cost totals, gauge values for
 * sessions, pending approvals, dispatch-paused, active runs, queue depth,
 * and the duration histogram body — and `503` when no daemon has
 * registered a metrics source. Workflow runtime reads route through a stub
 * `WorkflowMetricsSource` registered against the provider registry,
 * mirroring how the daemon registers its own source at startup.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getApprovalQueue, resetApprovalQueue } from "#core/daemon/approval-queue.js";
import {
  type DaemonControlHandle,
  DaemonControlServer,
  type WorkflowMetricCounts,
} from "#core/daemon/daemon-control.js";
import {
  WORKFLOW_METRICS_SOURCE_PROVIDER_TYPE,
  type WorkflowMetricsSource,
} from "#core/daemon/metrics-source-provider.js";
import {
  getProviderRegistry,
  initProviderRegistry,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { tracingControlRoutes } from "./routes.js";

const TEST_TOKEN = "tracing-test-token";

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
    getWorkflowMetricCounts: vi.fn((): WorkflowMetricCounts => ({
      runCounts: [],
      costTotals: [],
      durationHistogram: [],
    })),
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

async function fetchWith(port: number, path: string): Promise<Response> {
  return globalThis.fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { Authorization: `Bearer ${TEST_TOKEN}` },
  });
}

function registerSource(source: WorkflowMetricsSource): void {
  const registry = getProviderRegistry();
  if (!registry) throw new Error("provider registry not initialized");
  registry.register(WORKFLOW_METRICS_SOURCE_PROVIDER_TYPE, "test", source);
}

describe("tracing module daemon-control routes", () => {
  let server: DaemonControlServer;
  let port: number;
  let approvalsDir: string;

  beforeEach(async () => {
    approvalsDir = mkdtempSync(join(tmpdir(), "kota-tracing-metrics-"));
    resetProviderRegistry();
    initProviderRegistry();
    resetApprovalQueue();
    getApprovalQueue(approvalsDir);
    server = new DaemonControlServer(makeHandle(), TEST_TOKEN, {
      controlRoutes: tracingControlRoutes(),
    });
    port = await server.start();
  });

  afterEach(async () => {
    await server.stop();
    resetApprovalQueue();
    resetProviderRegistry();
    rmSync(approvalsDir, { recursive: true, force: true });
  });

  describe("registration seam", () => {
    it("declares GET /metrics with read capability scope", () => {
      const routes = tracingControlRoutes();
      expect(routes.map((r) => `${r.method} ${r.path} (${r.capabilityScope})`)).toEqual([
        "GET /metrics (read)",
      ]);
    });

    it("requires the daemon bearer token", async () => {
      const res = await globalThis.fetch(`http://127.0.0.1:${port}/metrics`);
      expect(res.status).toBe(401);
    });
  });

  describe("GET /metrics", () => {
    it("returns 503 when no metrics source has been registered", async () => {
      const res = await fetchWith(port, "/metrics");
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body).toEqual({ error: "Metrics source unavailable" });
    });

    it("returns 200 with Prometheus text format and zero baseline", async () => {
      registerSource({
        getWorkflowMetricCounts: () => ({
          runCounts: [],
          costTotals: [],
          durationHistogram: [],
        }),
        listSessions: () => [],
        getWorkflowLiveStatus: () => ({
          activeRuns: [],
          pendingRuns: [],
          queueLength: 0,
          completedRuns: 0,
          workflows: {},
          paused: false,
          agentConcurrency: 1,
          codeConcurrency: 4,
        }),
      });

      const res = await fetchWith(port, "/metrics");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/plain; version=0.0.4; charset=utf-8");
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

    it("renders per-workflow run counts, costs, sessions, approvals, and paused state", async () => {
      registerSource({
        getWorkflowMetricCounts: () => ({
          runCounts: [
            { workflow: "builder", status: "success", count: 10 },
            { workflow: "builder", status: "failed", count: 2 },
            { workflow: "explorer", status: "success", count: 5 },
          ],
          costTotals: [{ workflow: "builder", costUsd: 1.5 }],
          durationHistogram: [],
        }),
        listSessions: () => [
          {
            id: "s1",
            createdAt: "2026-01-01T00:00:00Z",
            lastActive: 0,
            autonomyMode: "supervised" as const,
          },
        ],
        getWorkflowLiveStatus: () => ({
          activeRuns: [],
          pendingRuns: [],
          queueLength: 0,
          completedRuns: 17,
          workflows: {},
          paused: true,
          agentConcurrency: 1,
          codeConcurrency: 4,
        }),
      });
      getApprovalQueue().enqueue("Bash", {}, "moderate", "test");

      const res = await fetchWith(port, "/metrics");
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

    it("renders active-run and queue-depth gauges with non-zero values", async () => {
      registerSource({
        getWorkflowMetricCounts: () => ({
          runCounts: [],
          costTotals: [],
          durationHistogram: [],
        }),
        listSessions: () => [],
        getWorkflowLiveStatus: () => ({
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
        }),
      });

      const res = await fetchWith(port, "/metrics");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('kota_workflow_active_runs{workflow="builder"} 2');
      expect(text).toContain('kota_workflow_active_runs{workflow="explorer"} 1');
      expect(text).toContain("kota_workflow_queued_runs 3");
    });

    it("renders the duration histogram when entries are present", async () => {
      registerSource({
        getWorkflowMetricCounts: () => ({
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
        }),
        listSessions: () => [],
        getWorkflowLiveStatus: () => ({
          activeRuns: [],
          pendingRuns: [],
          queueLength: 0,
          completedRuns: 0,
          workflows: {},
          paused: false,
          agentConcurrency: 1,
          codeConcurrency: 4,
        }),
      });

      const res = await fetchWith(port, "/metrics");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("# TYPE kota_workflow_run_duration_seconds histogram");
      expect(text).toContain(
        'kota_workflow_run_duration_seconds_bucket{workflow="builder",status="success",le="1800"} 12',
      );
      expect(text).toContain(
        'kota_workflow_run_duration_seconds_bucket{workflow="builder",status="success",le="+Inf"} 14',
      );
      expect(text).toContain(
        'kota_workflow_run_duration_seconds_sum{workflow="builder",status="success"} 9480',
      );
      expect(text).toContain(
        'kota_workflow_run_duration_seconds_count{workflow="builder",status="success"} 14',
      );
    });

    it("escapes label values containing special characters", async () => {
      registerSource({
        getWorkflowMetricCounts: () => ({
          runCounts: [
            { workflow: 'edge"case\\with\nspecials', status: "success", count: 1 },
          ],
          costTotals: [],
          durationHistogram: [],
        }),
        listSessions: () => [],
        getWorkflowLiveStatus: () => ({
          activeRuns: [],
          pendingRuns: [],
          queueLength: 0,
          completedRuns: 0,
          workflows: {},
          paused: false,
          agentConcurrency: 1,
          codeConcurrency: 4,
        }),
      });

      const res = await fetchWith(port, "/metrics");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain(
        'kota_workflow_runs_total{workflow="edge\\"case\\\\with\\nspecials",status="success"} 1',
      );
    });
  });

  describe("collision detection", () => {
    it("throws at server construction if two contributions claim the same route key", () => {
      const collision = [
        ...tracingControlRoutes(),
        {
          method: "GET" as const,
          path: "/metrics",
          capabilityScope: "read" as const,
          handler: (
            _req: unknown,
            res: { writeHead: (s: number) => void; end: () => void },
          ) => {
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
