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
import { type ApprovalQueue, getApprovalQueue, resetApprovalQueue } from "#core/daemon/approval-queue.js";
import {
  type DaemonControlHandle,
  DaemonControlServer,
  type WorkflowMetricCounts,
} from "#core/daemon/daemon-control.js";
import { approvalControlRoutes } from "./routes.js";

const TEST_TOKEN = "approvals-test-token";

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
    getWorkflowMetricCounts: vi.fn((): WorkflowMetricCounts => ({ runCounts: [], costTotals: [], durationHistogram: [] })),
    registerSession: vi.fn(),
    unregisterSession: vi.fn(),
    listSessions: vi.fn(() => []),
    setSessionAutonomyMode: vi.fn(() => ({ ok: false, notFound: true })),
    reloadConfig: vi.fn(async () => ({ workflows: 0, changedModules: [] })),
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

describe("approval-queue module daemon-control routes", () => {
  let server: DaemonControlServer;
  let port: number;
  let queueDir: string;
  let queue: ApprovalQueue;

  beforeEach(async () => {
    queueDir = mkdtempSync(join(tmpdir(), "kota-approvals-control-"));
    resetApprovalQueue();
    queue = getApprovalQueue(queueDir);
    server = new DaemonControlServer(makeHandle(), TEST_TOKEN, {
      controlRoutes: approvalControlRoutes(),
    });
    port = await server.start();
  });

  afterEach(async () => {
    await server.stop();
    resetApprovalQueue();
    rmSync(queueDir, { recursive: true, force: true });
  });

  describe("registration seam", () => {
    it("declares /approvals routes with read/control capability scopes", () => {
      const routes = approvalControlRoutes();
      expect(routes.map((r) => `${r.method} ${r.path} (${r.capabilityScope})`)).toEqual([
        "GET /approvals (read)",
        "POST /approvals/approve-all (control)",
        "POST /approvals/reject-all (control)",
        "POST /approvals/:id/approve (control)",
        "POST /approvals/:id/reject (control)",
      ]);
    });

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
    it("returns 200 with empty list when no pending approvals exist", async () => {
      const res = await fetchWith(port, "/approvals");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ approvals: [] });
    });

    it("returns pending approvals from the queue", async () => {
      queue.enqueue("shell", { command: "rm -rf /tmp/foo" }, "dangerous", "cleanup");
      queue.enqueue("git", { args: ["push", "--force"] }, "dangerous", "force push");

      const res = await fetchWith(port, "/approvals");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { approvals: Array<{ tool: string; status: string }> };
      expect(body.approvals).toHaveLength(2);
      expect(body.approvals.every((a) => a.status === "pending")).toBe(true);
      expect(body.approvals.map((a) => a.tool).sort()).toEqual(["git", "shell"]);
    });

    it("excludes resolved approvals", async () => {
      const item = queue.enqueue("shell", { command: "echo" }, "safe", "noop");
      queue.approve(item.id);

      const res = await fetchWith(port, "/approvals");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ approvals: [] });
    });
  });

  describe("POST /approvals/:id/approve", () => {
    it("approves a pending item and returns it", async () => {
      const item = queue.enqueue("shell", { command: "deploy.sh" }, "moderate", "deploy");

      const res = await fetchWith(port, `/approvals/${item.id}/approve`, { method: "POST" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { approval: { id: string; status: string } };
      expect(body.approval.id).toBe(item.id);
      expect(body.approval.status).toBe("approved");
    });

    it("attaches the note from the request body", async () => {
      const item = queue.enqueue("shell", { command: "deploy.sh" }, "moderate", "deploy");

      const res = await fetchWith(port, `/approvals/${item.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "please add a unit test" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { approval: { approvalNote?: string } };
      expect(body.approval.approvalNote).toBe("please add a unit test");
    });

    it("returns 404 when the approval is missing", async () => {
      const res = await fetchWith(port, "/approvals/missing/approve", { method: "POST" });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Approval not found or not pending");
    });

    it("returns 404 when the approval is no longer pending", async () => {
      const item = queue.enqueue("shell", { command: "echo" }, "safe", "already approved");
      queue.approve(item.id);

      const res = await fetchWith(port, `/approvals/${item.id}/approve`, { method: "POST" });
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
      const body = (await res.json()) as { approval: { id: string; status: string; rejectionReason?: string } };
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
      const res = await fetchWith(port, "/approvals/missing/reject", { method: "POST" });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /approvals/approve-all", () => {
    it("approves every pending item and returns the bulk envelope", async () => {
      queue.enqueue("shell", { command: "a.sh" }, "moderate", "task a");
      queue.enqueue("shell", { command: "b.sh" }, "moderate", "task b");

      const res = await fetchWith(port, "/approvals/approve-all", { method: "POST" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { approvals: Array<{ status: string }>; count: number };
      expect(body.count).toBe(2);
      expect(body.approvals.every((a) => a.status === "approved")).toBe(true);
    });

    it("returns an empty bulk envelope when nothing is pending", async () => {
      const res = await fetchWith(port, "/approvals/approve-all", { method: "POST" });
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
