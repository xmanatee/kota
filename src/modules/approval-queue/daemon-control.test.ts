import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApprovalQueue,
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
import { OwnerDecisionStore } from "#core/daemon/owner-decision-store.js";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import {
  buildDirectoryScope,
  buildScopeRegistryProjection,
  type DirectoryScope,
} from "#core/daemon/scope-registry.js";
import { initProviderRegistry, resetProviderRegistry } from "#core/modules/provider-registry.js";
import type { ToolRunner } from "#core/tools/index.js";
import {
  clearApprovalExecutionTestTools,
  registerApprovalExecutionTestTools,
} from "./approval-execution-test-tools.integration.js";
import { approvePending, reviewDigest } from "./approval-route-test-support.integration.js";
import { approvalControlRoutes } from "./routes.js";

const TEST_TOKEN = "approvals-test-token";

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
      concurrency: 4,
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
    getWorkflowMetricCounts: vi.fn(
      (): WorkflowMetricCounts => ({
        runCounts: [],
        costTotals: [],
        durationHistogram: [],
        deadLetterCounts: { open: 0, dismissed: 0, redriven: 0 },
      }),
    ),
    registerSession: vi.fn(),
    unregisterSession: vi.fn(),
    listSessions: vi.fn(() => []),
    setSessionAutonomyMode: vi.fn(() => ({ ok: false, notFound: true })),
    getScopeRegistryProjection: vi.fn(() => ({
      rootScopeId: "global",
      defaultScopeId: "test-scope-id",
      scopes: [
        { scopeId: "global", displayName: "Global" },
        {
          scopeId: "test-scope-id",
          parentScopeId: "global",
          directoryRoot: "/tmp/test-scope",
          displayName: "test-scope",
        },
      ],
    })),
    hasScope: vi.fn((id: string) => id === "test-scope-id"),
    getActiveScopeId: vi.fn(() => null),
    setActiveScopeId: vi.fn((id: string | null) =>
      id === null
        ? { ok: true as const, activeScopeId: null }
        : id === "test-scope-id"
          ? { ok: true as const, activeScopeId: id }
          : { ok: false as const, reason: "not_found" as const, scopeId: id },
    ),
    reloadConfig: vi.fn(async () => ({
      workflows: 0,
      changedModules: [],
      sessionGuardrails: { refreshed: 0, unchanged: 0, nonRefreshable: [] },
    })),
    probeCapabilityReadiness: vi.fn(async () => ({
      capabilities: [],
      summary: { ready: 0, unavailable: 0, init_failed: 0 },
    })),
    getClientIdentity: vi.fn(async () => ({
      scopeName: "test-scope",
      scopeRoot: "/tmp/test-scope",
      scopeRegistry: {
        rootScopeId: "global",
        defaultScopeId: "test-scope-id",
        scopes: [
          { scopeId: "global", displayName: "Global" },
          {
            scopeId: "test-scope-id",
            parentScopeId: "global",
            directoryRoot: "/tmp/test-scope",
            displayName: "test-scope",
          },
        ],
      },
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

async function fetchWith(port: number, path: string, init: RequestInit = {}): Promise<Response> {
  return globalThis.fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TEST_TOKEN}`, ...init.headers },
  });
}

const executeTool = vi.fn<ToolRunner>();

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

function registerScopeQueueProvider(
  entries: Array<{
    scope: DirectoryScope;
    approvalQueue: ApprovalQueue;
    ownerDecisionStore: OwnerDecisionStore;
    ownerQuestionQueue: OwnerQuestionQueue;
  }>,
): void {
  const defaultEntry = entries[0];
  if (!defaultEntry) throw new Error("expected at least one scope");
  const byId = new Map(entries.map((entry) => [entry.scope.scopeId, entry]));
  const registry = initProviderRegistry();
  registry.register(DAEMON_SCOPE_PROVIDER_TYPE, "test", {
    getScopeRegistryProjection: () =>
      buildScopeRegistryProjection(
        defaultEntry.scope.scopeId,
        entries.map((entry) => entry.scope),
      ),
    getActiveScopeId: () => null,
    resolveScopeRuntime: (scopeId) => {
      const selected = scopeId?.trim() || defaultEntry.scope.scopeId;
      const entry = byId.get(selected);
      if (!entry) {
        return {
          ok: false,
          error: {
            error: "Unknown scope",
            reason: "unknown_scope",
            scopeId: selected,
          },
        };
      }
      return {
        ok: true,
        runtime: {
          scope: entry.scope,
          approvalQueue: entry.approvalQueue,
          secretStore: {} as never,
          ownerDecisionStore: entry.ownerDecisionStore,
          ownerQuestionQueue: entry.ownerQuestionQueue,
        },
      };
    },
  });
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

describe("approval-queue module daemon-control routes", () => {
  let server: DaemonControlServer;
  let port: number;
  let queueDir: string;
  let queue: ApprovalQueue;
  beforeEach(async () => {
    registerApprovalExecutionTestTools(executeTool);
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
    clearApprovalExecutionTestTools();
    vi.clearAllMocks();
    rmSync(queueDir, { recursive: true, force: true });
  });
  describe("registration seam", () => {
    it("requires the daemon bearer token on all five routes", async () => {
      for (const init of [
        { path: "/approvals", method: "GET" },
        { path: "/approvals/anything/approve", method: "POST" },
        { path: "/approvals/anything/reject", method: "POST" },
        { path: "/approvals/approve-all", method: "POST" },
        { path: "/approvals/reject-all", method: "POST" },
      ]) {
        const res = await globalThis.fetch(`http://127.0.0.1:${port}${init.path}`, {
          method: init.method,
        });
        expect(res.status).toBe(401);
      }
    });
  });

  describe("GET /approvals", () => {
    it("returns the list envelope and forwards the default pending filter", async () => {
      const res = await fetchWith(port, "/approvals");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ approvals: [] });
      const resolved = queue.enqueue("shell", { command: "done" }, "safe", "resolved");
      queue.reject(resolved.id, "declined");
      const pending = queue.enqueue("git", { args: ["status"] }, "safe", "pending");
      const listed = await fetchWith(port, "/approvals");
      expect(listed.status).toBe(200);
      expect(await listed.json()).toMatchObject({
        approvals: [{ id: pending.id, status: "pending" }],
      });
    });

    it("uses the scopeId query to list and mutate the selected scope's queue", async () => {
      mkdirSync(join(queueDir, "scope-a"));
      mkdirSync(join(queueDir, "scope-b"));
      const scopeA = buildDirectoryScope({
        scopeRoot: join(queueDir, "scope-a"),
        displayName: "Scope A",
      });
      const scopeB = buildDirectoryScope({
        scopeRoot: join(queueDir, "scope-b"),
        displayName: "Scope B",
      });
      const approvalA = new ApprovalQueue(join(scopeA.scopeRoot, ".kota", "approvals"));
      const approvalB = new ApprovalQueue(join(scopeB.scopeRoot, ".kota", "approvals"));
      const decisionA = new OwnerDecisionStore(
        join(scopeA.scopeRoot, ".kota", "owner-decisions"),
        scopeA.scopeId,
      );
      const decisionB = new OwnerDecisionStore(
        join(scopeB.scopeRoot, ".kota", "owner-decisions"),
        scopeB.scopeId,
      );
      const ownerA = new OwnerQuestionQueue(join(scopeA.scopeRoot, ".kota", "owner-questions"));
      const ownerB = new OwnerQuestionQueue(join(scopeB.scopeRoot, ".kota", "owner-questions"));
      registerScopeQueueProvider([
        {
          scope: scopeA,
          approvalQueue: approvalA,
          ownerDecisionStore: decisionA,
          ownerQuestionQueue: ownerA,
        },
        {
          scope: scopeB,
          approvalQueue: approvalB,
          ownerDecisionStore: decisionB,
          ownerQuestionQueue: ownerB,
        },
      ]);

      const itemA = approvalA.enqueue("shell", { command: "a" }, "moderate", "a");
      const itemB = approvalB.enqueue("shell", { command: "b" }, "moderate", "b");

      const listB = await fetchWith(port, `/approvals?scopeId=${scopeB.scopeId}`);
      expect(listB.status).toBe(200);
      const body = (await listB.json()) as { approvals: Array<{ id: string }> };
      expect(body.approvals.map((item) => item.id)).toEqual([itemB.id]);

      const approveB = await fetchWith(
        port,
        `/approvals/${itemB.id}/approve?scopeId=${scopeB.scopeId}`,
        approvalPost(approvalB, itemB.id),
      );
      expect(approveB.status).toBe(200);
      expect(approvalA.get(itemA.id)?.status).toBe("pending");
      expect(approvalB.get(itemB.id)?.status).toBe("approved");
    });
  });

  describe("POST /approvals/:id/approve", () => {
    it("approves a pending item and returns it", async () => {
      const item = queue.enqueue("shell", { command: "deploy.sh" }, "moderate", "deploy");

      const res = await fetchWith(
        port,
        `/approvals/${item.id}/approve`,
        approvalPost(queue, item.id),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { approval: { id: string; status: string } };
      expect(body.approval.id).toBe(item.id);
      expect(body.approval.status).toBe("approved");
    });

    it("executes against raw queue input while returning redacted approval and execution projections", async () => {
      const item = queue.enqueue(
        "shell",
        { command: "deploy.sh", accessToken: "raw-token" },
        "moderate",
        "deploy",
      );
      vi.mocked(executeTool).mockResolvedValueOnce({ content: "deployed raw-token" });

      const res = await fetchWith(
        port,
        `/approvals/${item.id}/approve`,
        approvalPost(queue, item.id),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        approval: { input: Record<string, unknown>; status: string };
        resolution: {
          kind: string;
          execution: { status: string; output: { redacted: true; reason: string } };
        };
      };
      expect(vi.mocked(executeTool)).toHaveBeenCalledWith(
        { command: "deploy.sh", accessToken: "raw-token" },
        undefined,
      );
      expect(body.approval.status).toBe("approved");
      expect(body.approval.input).toMatchObject({ redacted: true, reason: "tool-io" });
      expect(body.resolution).toMatchObject({
        kind: "tool_execution",
        execution: {
          status: "succeeded",
          output: { redacted: true, reason: "tool-io" },
        },
      });
      expect(JSON.stringify(body)).not.toContain("raw-token");
      expect(JSON.stringify(body)).not.toContain("deployed raw-token");
    });

    it("fails closed after daemon restart when raw queue input is unavailable", async () => {
      const item = queue.enqueue(
        "shell",
        { command: "deploy.sh", accessToken: "raw-token" },
        "moderate",
        "deploy",
      );
      const restarted = new ApprovalQueue(queueDir);
      setApprovalQueueInstance(restarted);

      const res = await fetchWith(port, `/approvals/${item.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewDigest: "a".repeat(64) }),
      });

      expect(res.status).toBe(409);
      const body = (await res.json()) as {
        reason: string;
        approvals: Array<{ id: string; status: string }>;
      };
      expect(body.reason).toBe("approval_input_unavailable");
      expect(body.approvals).toEqual([expect.objectContaining({ id: item.id, status: "pending" })]);
      expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
      expect(restarted.get(item.id)?.status).toBe("pending");
      expect(JSON.stringify(body)).not.toContain("raw-token");
    });

    it("attaches the note from the request body", async () => {
      const item = queue.enqueue("shell", { command: "deploy.sh" }, "moderate", "deploy");

      const res = await fetchWith(
        port,
        `/approvals/${item.id}/approve`,
        approvalPost(queue, item.id, "please add a unit test"),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { approval: { approvalNote?: string } };
      expect(body.approval.approvalNote).toBe("please add a unit test");
    });

    it("returns 404 when the approval is missing", async () => {
      const res = await fetchWith(port, "/approvals/deadbeef/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewDigest: "a".repeat(64) }),
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Approval not found or not pending");
    });

    it("rejects an encoded slash approval id before queue mutation", async () => {
      const item = queue.enqueue("shell", { command: "deploy.sh" }, "moderate", "deploy");

      const res = await fetchWith(port, `/approvals/..%2F${item.id}/approve`, { method: "POST" });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { reason: string };
      expect(body.reason).toBe("invalid_approval_id");
      expect(queue.get(item.id)?.status).toBe("pending");
    });

    it("returns 404 when the approval is no longer pending", async () => {
      const item = queue.enqueue("shell", { command: "echo" }, "safe", "already approved");
      approvePending(queue, item.id);

      const res = await fetchWith(port, `/approvals/${item.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewDigest: "a".repeat(64) }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /approvals/:id/reject", () => {
    it("rejects a pending item and returns it", async () => {
      const item = queue.enqueue("git", { args: ["reset", "--hard"] }, "dangerous", "reset");

      const res = await fetchWith(port, `/approvals/${item.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "not now" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        approval: { id: string; status: string; rejectionReason?: string };
      };
      expect(body.approval.id).toBe(item.id);
      expect(body.approval.status).toBe("rejected");
      expect(body.approval.rejectionReason).toBe("not now");
    });

    it("rejects without a reason when the body omits it", async () => {
      const item = queue.enqueue("shell", { command: "reboot" }, "dangerous", "system reboot");

      const res = await fetchWith(port, `/approvals/${item.id}/reject`, { method: "POST" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { approval: { status: string; rejectionReason?: string } };
      expect(body.approval.status).toBe("rejected");
      expect(body.approval.rejectionReason).toBeUndefined();
    });

    it("returns 404 when the approval is missing", async () => {
      const res = await fetchWith(port, "/approvals/deadbeef/reject", { method: "POST" });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /approvals/approve-all", () => {
    it("approves every pending item and returns the bulk envelope", async () => {
      queue.enqueue("shell", { command: "a.sh" }, "moderate", "task a");
      queue.enqueue("shell", { command: "b.sh" }, "moderate", "task b");

      const res = await fetchWith(port, "/approvals/approve-all", approveAllPost(queue));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { approvals: Array<{ status: string }>; count: number };
      expect(body.count).toBe(2);
      expect(body.approvals.every((a) => a.status === "approved")).toBe(true);
    });

    it("returns an empty bulk envelope when nothing is pending", async () => {
      const res = await fetchWith(port, "/approvals/approve-all", approveAllPost(queue));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { approvals: unknown[]; count: number };
      expect(body.count).toBe(0);
      expect(body.approvals).toEqual([]);
    });
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
      const body = (await res.json()) as {
        approvals: Array<{ status: string; rejectionReason?: string }>;
        count: number;
      };
      expect(body.count).toBe(2);
      expect(body.approvals.every((a) => a.status === "rejected")).toBe(true);
      expect(body.approvals.every((a) => a.rejectionReason === "cleanup")).toBe(true);
    });
  });

  describe("capability scope", () => {
    it("rejects mutating routes when the bearer token is absent (control scope still requires auth)", async () => {
      const item = queue.enqueue("shell", { command: "echo" }, "safe", "demo");
      const noAuth = await globalThis.fetch(
        `http://127.0.0.1:${port}/approvals/${item.id}/approve`,
        {
          method: "POST",
        },
      );
      expect(noAuth.status).toBe(401);
      // The item is still pending after the unauthorized request.
      expect(queue.list("pending")).toHaveLength(1);
    });
  });

  describe("collision detection", () => {
    it("throws at server construction if two contributions claim the same route key", async () => {
      const collision = [
        ...approvalControlRoutes(),
        {
          method: "GET" as const,
          path: "/approvals",
          capabilityScope: "read" as const,
          handler: (_req: unknown, res: { writeHead: (s: number) => void; end: () => void }) => {
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
