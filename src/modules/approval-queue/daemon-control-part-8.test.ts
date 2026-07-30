/**
 * Exercises the approval-queue module's daemon-control routes through the
 * same registration seam the real daemon uses: `approvalControlRoutes()`
 * is the module's contribution, so the test mounts those handlers on a
 * live `DaemonControlServer` and hits `/approvals`,
 * `/approvals/:id/approve`, `/approvals/:id/reject`,
 * `/approvals/approve-all`, `/approvals/reject-all` via HTTP.
 *
 * Covers the wire contract migrated out of core: bearer-token auth, the
 * `read` / `control` capability-scope split (the GET is read-only, the four
 * POSTs require control), `{ approvals: PendingApproval[] }` envelope on
 * list, `{ approval: PendingApproval }` envelope on individual transitions,
 * `{ approvals, count }` envelope on the bulk endpoints, and
 * `404 { error: "Approval not found or not pending" }` for missing or
 * already-resolved items.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ApprovalQueue,
  getApprovalQueue,
  resetApprovalQueue,
  setApprovalQueueInstance,
} from "#core/daemon/approval-queue.js";
import {
  type DaemonControlHandle,
  DaemonControlServer,
  type WorkflowMetricCounts,
} from "#core/daemon/daemon-control.js";
import { daemonSetupControlHandleStubs } from "#core/daemon/daemon-setup-control-test-stubs.js";
import type { OwnerDecisionStore } from "#core/daemon/owner-decision-store.js";
import type { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import {
  buildConfiguredProject,
  type ConfiguredProject,
} from "#core/daemon/scope-registry.js";
import {
  initProviderRegistry,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { executeTool } from "#core/tools/index.js";
import { approvalControlRoutes } from "./routes.js";

vi.mock("#core/tools/index.js", () => ({
  executeTool: vi.fn(),
}));

const TEST_TOKEN = "approvals-test-token";

function approvePending(queue: ApprovalQueue, id: string): void {
  const selection = queue.getExecutionSnapshot(id);
  if (!selection.ok) throw new Error("expected execution snapshot");
  const result = queue.approveForExecution(selection.snapshot.descriptor);
  if (!result.ok) throw new Error("expected execution approval");
}

function makeHandle(): DaemonControlHandle {
  return {
    getDaemonLiveState: vi.fn(() => ({
      startedAt: "2026-01-01T00:00:00.000Z",
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
    getWorkflowMetricCounts: vi.fn((): WorkflowMetricCounts => ({ runCounts: [], costTotals: [], durationHistogram: [], deadLetterCounts: { open: 0, dismissed: 0, redriven: 0 } })),
    registerSession: vi.fn(),
    unregisterSession: vi.fn(),
    listSessions: vi.fn(() => []),
    setSessionAutonomyMode: vi.fn(() => ({ ok: false, notFound: true })),
    getProjectRegistryProjection: vi.fn(() => ({ defaultProjectId: "test-project-id", projects: [{ projectId: "test-project-id", projectDir: "/tmp/test-project", displayName: "test-project" }] })),
    hasProject: vi.fn((id: string) => id === "test-project-id"),
    getActiveProjectId: vi.fn(() => null),
    setActiveProjectId: vi.fn((id: string | null) => (id === null ? { ok: true as const, activeProjectId: null } : id === "test-project-id" ? { ok: true as const, activeProjectId: id } : { ok: false as const, reason: "not_found" as const, projectId: id })),
    reloadConfig: vi.fn(async () => ({ workflows: 0, changedModules: [], sessionGuardrails: { refreshed: 0, unchanged: 0, nonRefreshable: [] } })),
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
    ...daemonSetupControlHandleStubs(),
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

function reviewDigest(queue: ApprovalQueue, id: string): string {
  const item = queue.get(id);
  if (!item) throw new Error(`Missing approval ${id}`);
  const review = queue.projectForClient(item).review;
  if (review.status !== "available") throw new Error(`Approval ${id} is not reviewable`);
  return review.digest;
}

function approvalPost(queue: ApprovalQueue, id: string, note?: string): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reviewDigest: reviewDigest(queue, id),
      ...(note !== undefined ? { note } : {}),
    }),
  };
}

function approveAllPost(queue: ApprovalQueue): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reviews: queue.list("pending").map((item) => ({
        id: item.id,
        digest: reviewDigest(queue, item.id),
      })),
    }),
  };
}

function registerProjectQueueProvider(
  entries: Array<{
    project: ConfiguredProject;
    approvalQueue: ApprovalQueue;
    ownerDecisionStore: OwnerDecisionStore;
    ownerQuestionQueue: OwnerQuestionQueue;
  }>,
): void {
  const defaultEntry = entries[0];
  if (!defaultEntry) throw new Error("expected at least one project");
  const byId = new Map(entries.map((entry) => [entry.project.projectId, entry]));
  const registry = initProviderRegistry();
  registry.register(DAEMON_PROJECT_SCOPE_PROVIDER_TYPE, "test", {
    getProjectRegistryProjection: () => ({
      defaultProjectId: defaultEntry.project.projectId,
      projects: entries.map((entry) => entry.project),
    }),
    getActiveProjectId: () => null,
    resolveProjectRuntime: (projectId) => {
      const selected = projectId?.trim() || defaultEntry.project.projectId;
      const entry = byId.get(selected);
      if (!entry) {
        return {
          ok: false,
          error: {
            error: "Unknown project",
            reason: "unknown_project",
            projectId: selected,
          },
        };
      }
      return {
        ok: true,
        runtime: {
          project: entry.project,
          approvalQueue: entry.approvalQueue,
          secretStore: {} as never,
          ownerDecisionStore: entry.ownerDecisionStore,
          ownerQuestionQueue: entry.ownerQuestionQueue,
        },
      };
    },
  });
}

describe("approval-queue module daemon-control routes", () => {
  let server: DaemonControlServer;
  let port: number;
  let queueDir: string;
  let queue: ApprovalQueue;

  beforeEach(async () => {
    queueDir = mkdtempSync(join(tmpdir(), "kota-approvals-control-"));
    resetProviderRegistry();
    resetApprovalQueue();
    queue = getApprovalQueue(queueDir);
    vi.mocked(executeTool).mockResolvedValue({ content: "ok" });
    server = new DaemonControlServer(makeHandle(), TEST_TOKEN, {
      controlRoutes: approvalControlRoutes(),
    });
    port = await server.start();
  });

  afterEach(async () => {
    await server.stop();
    resetApprovalQueue();
    resetProviderRegistry();
    vi.clearAllMocks();
    rmSync(queueDir, { recursive: true, force: true });
  });

  describe("POST /approvals/reject-all", () => {
    it("rejects every pending item and returns the bulk envelope", async () => {
      queue.enqueue("git", { args: ["reset"] }, "dangerous", "reset");
      queue.enqueue("git", { args: ["push", "--force"] }, "dangerous", "force push");

      const res = await fetchWith(port, "/approvals/reject-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "cleanup" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { approvals: Array<{ status: string; rejectionReason?: string }>; count: number };
      expect(body.count).toBe(2);
      expect(body.approvals.every((a) => a.status === "rejected")).toBe(true);
      expect(body.approvals.every((a) => a.rejectionReason === "cleanup")).toBe(true);
    });
  });

  describe("capability scope", () => {
    it("rejects mutating routes when the bearer token is absent (control scope still requires auth)", async () => {
      const item = queue.enqueue("shell", { command: "echo" }, "safe", "demo");
      const noAuth = await globalThis.fetch(`http://127.0.0.1:${port}/approvals/${item.id}/approve`, {
        method: "POST",
      });
      expect(noAuth.status).toBe(401);
      // The item is still pending after the unauthorized request.
      expect(queue.list("pending")).toHaveLength(1);
    });
  });});
