import { mkdtempSync, rmSync } from "node:fs";

import { tmpdir } from "node:os";

import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listActiveApprovalExecutionIds } from "#core/daemon/approval-execution-activity.js";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { ToolRunner } from "#core/tools/index.js";
import {
  clearApprovalExecutionTestTools,
  registerApprovalExecutionTestTools,
} from "./approval-execution-test-tools.integration.js";
import {
  approvalBatchDecisionBody,
  approvalDecisionBody,
  approvePending,
  mockRequest,
  mockResponse,
  reviewDigest,
} from "./approval-route-test-support.integration.js";
import {
  handleApproveAllApprovals,
  handleApproveApproval,
  handleListApprovals,
  handleRejectAllApprovals,
  handleRejectApproval,
} from "./routes.js";

const queueDirs: string[] = [];

function makeQueue(): ApprovalQueue {
  const dir = mkdtempSync(join(tmpdir(), "kota-approvals-route-"));
  queueDirs.push(dir);
  return new ApprovalQueue(dir);
}

function mockTransport(
  value: unknown = null,
): import("#core/server/daemon-transport.js").DaemonTransport {
  const transport: import("#core/server/daemon-transport.js").DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({}),
    request: async <T>() => value as T | null,
    requestStrict: async () => {
      throw new Error("unexpected strict request");
    },
    fetchRaw: vi.fn(async () =>
      value instanceof Response
        ? value
        : Response.json(value, { status: value === null ? 404 : 200 }),
    ),
    events: async function* () {},
  };
  vi.spyOn(transport, "request");
  return transport;
}

const executeTool = vi.fn<ToolRunner>();

describe("approval-routes", () => {
  let queue: ApprovalQueue;
  beforeEach(() => {
    registerApprovalExecutionTestTools(executeTool);
    queue = makeQueue();
    executeTool.mockResolvedValue({ content: "ok" });
  });
  afterEach(() => {
    clearApprovalExecutionTestTools();
    for (const dir of queueDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });
  describe("daemon client proxy", () => {
    it("handleListApprovals returns daemon response when client succeeds", async () => {
      const approvals = [{ id: "a1", tool: "shell", status: "pending" }];
      const link = mockTransport({ approvals });
      const { res, result } = mockResponse();
      await handleListApprovals(res, link, makeQueue());
      expect(result.status).toBe(200);
      expect((result.body as { approvals: unknown[] }).approvals).toEqual(approvals);
      expect(link.request).toHaveBeenCalledWith("GET", "/approvals");
    });

    it("handleListApprovals falls back to direct read when client returns null", async () => {
      const link = mockTransport();
      const q = makeQueue();
      q.enqueue("shell", { command: "echo" }, "safe", "test");
      const { res, result } = mockResponse();
      await handleListApprovals(res, link, q);
      expect(result.status).toBe(200);
      expect((result.body as { approvals: unknown[] }).approvals).toHaveLength(1);
    });

    it("handleApproveApproval returns daemon response when client succeeds", async () => {
      const approval = { id: "abcd1234", tool: "shell", status: "approved" };
      const link = mockTransport({ approval });
      const { res, result } = mockResponse();
      await handleApproveApproval(
        mockRequest({ reviewDigest: "a".repeat(64) }),
        res,
        "abcd1234",
        link,
        makeQueue(),
      );
      expect(result.status).toBe(200);
      expect((result.body as { approval: unknown }).approval).toEqual(approval);
      expect(link.fetchRaw).toHaveBeenCalledWith("/approvals/abcd1234/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewDigest: "a".repeat(64) }),
      });
    });

    it("handleApproveApproval relays daemon 409 without falling back to a local approval", async () => {
      const item = queue.enqueue("shell", { command: "deploy.sh" }, "moderate", "deploy");
      const link = mockTransport(
        new Response(
          JSON.stringify({
            error: "Approval input is unavailable after daemon restart",
            reason: "approval_input_unavailable",
            approvals: [{ id: item.id }],
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      );
      const { res, result } = mockResponse();

      await handleApproveApproval(
        mockRequest(approvalDecisionBody(queue, item.id)),
        res,
        item.id,
        link,
        queue,
      );

      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({ reason: "approval_input_unavailable" });
      expect(queue.get(item.id)?.status).toBe("pending");
      expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
    });

    it("handleApproveApproval reports daemon transport failure without local fallback", async () => {
      const item = queue.enqueue("shell", { command: "deploy.sh" }, "moderate", "deploy");
      const link = {
        ...mockTransport(),
        fetchRaw: async () => {
          throw new Error("connection reset while proxying approval");
        },
      };
      const { res, result } = mockResponse();

      await handleApproveApproval(
        mockRequest(approvalDecisionBody(queue, item.id)),
        res,
        item.id,
        link,
        queue,
      );

      expect(result.status).toBe(502);
      expect(result.body).toMatchObject({ reason: "daemon_transport_failed" });
      expect(queue.get(item.id)?.status).toBe("pending");
      expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
    });

    it("handleRejectApproval returns daemon response when client succeeds", async () => {
      const approval = { id: "abcd1234", tool: "shell", status: "rejected" };
      const link = mockTransport({ approval });
      const { res, result } = mockResponse();
      await handleRejectApproval(mockRequest(), res, "abcd1234", link, makeQueue());
      expect(result.status).toBe(200);
      expect((result.body as { approval: unknown }).approval).toEqual(approval);
      expect(link.fetchRaw).toHaveBeenCalledWith("/approvals/abcd1234/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    });
  });

  describe("handleListApprovals", () => {
    it("redacts approval input and context in client-visible list projections", async () => {
      const item = queue.enqueue(
        "shell",
        {
          command: "deploy",
          authorization: "Bearer raw-token",
          contactEmail: "owner@example.test",
        },
        "dangerous",
        "deploy",
        "session",
        undefined,
        undefined,
        "full conversation with raw secret",
      );

      const { res, result } = mockResponse();
      await handleListApprovals(res, null, queue);

      expect(result.status).toBe(200);
      const body = result.body as {
        approvals: Array<{
          input: Record<string, unknown>;
          contextRedaction: { redacted: true; reason: string; bytes: number };
        }>;
      };
      expect(body.approvals[0].input).toMatchObject({
        redacted: true,
        reason: "tool-io",
      });
      expect(body.approvals[0]).not.toHaveProperty("context");
      expect(body.approvals[0].contextRedaction).toMatchObject({
        redacted: true,
        reason: "tool-io",
      });
      expect(JSON.stringify(queue.get(item.id))).not.toContain("raw-token");
    });

    it("returns every status when status filter is 'all'", async () => {
      const a = queue.enqueue("shell", { command: "ok" }, "safe", "ok");
      approvePending(queue, a.id);
      const b = queue.enqueue("shell", { command: "boom" }, "dangerous", "boom");
      queue.reject(b.id, "no");
      queue.enqueue("git", { args: ["status"] }, "safe", "still pending");

      const { res, result } = mockResponse();
      await handleListApprovals(res, null, queue, "all");
      expect(result.status).toBe(200);
      const body = result.body as { approvals: Array<{ status: string }> };
      expect(body.approvals.map((a) => a.status).sort()).toEqual([
        "approved",
        "pending",
        "rejected",
      ]);
    });

    it("filters by a specific status", async () => {
      queue.enqueue("git", { args: ["status"] }, "safe", "still pending");
      const b = queue.enqueue("shell", { command: "ok" }, "safe", "ok");
      approvePending(queue, b.id);

      const { res, result } = mockResponse();
      await handleListApprovals(res, null, queue, "approved");
      expect(result.status).toBe(200);
      const body = result.body as { approvals: Array<{ status: string }> };
      expect(body.approvals).toHaveLength(1);
      expect(body.approvals[0].status).toBe("approved");
    });

    it("forwards the status filter to the daemon client when one is configured", async () => {
      const link = mockTransport({ approvals: [] });
      const { res, result } = mockResponse();
      await handleListApprovals(res, link, makeQueue(), "all");
      expect(result.status).toBe(200);
      expect(link.request).toHaveBeenCalledWith("GET", "/approvals?status=all");
    });
  });

  describe("handleApproveApproval", () => {
    it("requires the digest the operator reviewed", async () => {
      const item = queue.enqueue("shell", { command: "deploy.sh" }, "moderate", "deploy");
      const { res, result } = mockResponse();

      await handleApproveApproval(mockRequest(), res, item.id, null, queue);

      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ reason: "invalid_approval_review_receipt" });
      expect(queue.get(item.id)?.status).toBe("pending");
      expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
    });

    it("rejects a digest from a different displayed operation", async () => {
      const first = queue.enqueue("shell", { command: "deploy-a.sh" }, "moderate", "deploy a");
      const second = queue.enqueue("shell", { command: "deploy-b.sh" }, "moderate", "deploy b");
      const { res, result } = mockResponse();

      await handleApproveApproval(
        mockRequest({ reviewDigest: reviewDigest(queue, first.id) }),
        res,
        second.id,
        null,
        queue,
      );

      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({
        reason: "approval_review_digest_mismatch",
        approvals: [{ id: second.id, status: "pending" }],
      });
      expect(queue.get(second.id)?.status).toBe("pending");
      expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
    });

    it("approves a pending item and returns it", async () => {
      const item = queue.enqueue(
        "shell",
        { command: "deploy.sh", accessToken: "raw-token" },
        "moderate",
        "deploy",
      );
      executeTool.mockResolvedValueOnce({ content: "deployed raw-token" });

      const { res, result } = mockResponse();
      await handleApproveApproval(
        mockRequest(approvalDecisionBody(queue, item.id)),
        res,
        item.id,
        null,
        queue,
      );
      expect(result.status).toBe(200);
      const body = result.body as {
        approval: { id: string; status: string; input: Record<string, unknown> };
        resolution: {
          kind: string;
          execution: { status: string; output: { redacted: true; reason: string } };
        };
      };
      expect(body.approval.id).toBe(item.id);
      expect(body.approval.status).toBe("approved");
      expect(body.approval.input).toMatchObject({ redacted: true, reason: "tool-io" });
      expect(body.resolution).toMatchObject({
        kind: "tool_execution",
        execution: {
          status: "succeeded",
          output: { redacted: true, reason: "tool-io" },
        },
      });
      expect(vi.mocked(executeTool)).toHaveBeenCalledWith(
        { command: "deploy.sh", accessToken: "raw-token" },
        expect.objectContaining({ cwd: process.cwd() }),
      );
      expect(JSON.stringify(result.body)).not.toContain("raw-token");
      expect(JSON.stringify(result.body)).not.toContain("deployed raw-token");
      expect(JSON.stringify(queue.get(item.id))).not.toContain("raw-token");
    });

    it("fails closed without executing or approving when persisted input is unavailable", async () => {
      const dir = mkdtempSync(join(tmpdir(), "kota-approvals-route-restart-"));
      try {
        const original = new ApprovalQueue(dir);
        const item = original.enqueue(
          "shell",
          { command: "deploy.sh", accessToken: "raw-token" },
          "moderate",
          "deploy",
        );
        const restarted = new ApprovalQueue(dir);

        const { res, result } = mockResponse();
        await handleApproveApproval(
          mockRequest({ reviewDigest: "a".repeat(64) }),
          res,
          item.id,
          null,
          restarted,
        );

        expect(result.status).toBe(409);
        expect(result.body).toMatchObject({
          reason: "approval_input_unavailable",
        });
        expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
        expect(restarted.get(item.id)?.status).toBe("pending");
        expect(JSON.stringify(result.body)).not.toContain("raw-token");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("stores note from request body when provided", async () => {
      const item = queue.enqueue("shell", { command: "deploy.sh" }, "moderate", "deploy");

      const { res, result } = mockResponse();
      await handleApproveApproval(
        mockRequest(approvalDecisionBody(queue, item.id, "please add a unit test")),
        res,
        item.id,
        null,
        queue,
      );
      expect(result.status).toBe(200);
      const body = result.body as { approval: { approvalNote: string } };
      expect(body.approval.approvalNote).toBe("please add a unit test");
    });

    it("approves without note when body omits it", async () => {
      const item = queue.enqueue("shell", { command: "deploy.sh" }, "moderate", "deploy");

      const { res, result } = mockResponse();
      await handleApproveApproval(
        mockRequest(approvalDecisionBody(queue, item.id)),
        res,
        item.id,
        null,
        queue,
      );
      expect(result.status).toBe(200);
      const body = result.body as { approval: { status: string; approvalNote?: string } };
      expect(body.approval.status).toBe("approved");
      expect(body.approval.approvalNote).toBeUndefined();
    });

    it("returns 404 for unknown id", async () => {
      const { res, result } = mockResponse();
      await handleApproveApproval(
        mockRequest({ reviewDigest: "a".repeat(64) }),
        res,
        "deadbeef",
        null,
        queue,
      );
      expect(result.status).toBe(404);
    });

    it("returns 400 for malformed decoded ids without mutating the queue", async () => {
      const item = queue.enqueue("shell", { command: "deploy.sh" }, "moderate", "deploy");

      const { res, result } = mockResponse();
      await handleApproveApproval(mockRequest(), res, `../${item.id}`, null, queue);

      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ reason: "invalid_approval_id" });
      expect(queue.get(item.id)?.status).toBe("pending");
    });

    it("returns 404 when item is not pending", async () => {
      const item = queue.enqueue("shell", { command: "echo" }, "safe", "already approved");
      approvePending(queue, item.id);

      const { res, result } = mockResponse();
      await handleApproveApproval(
        mockRequest({ reviewDigest: "a".repeat(64) }),
        res,
        item.id,
        null,
        queue,
      );
      expect(result.status).toBe(404);
    });

    it("keeps approved execution visible until tool and lease cleanup complete", async () => {
      const item = queue.enqueue("shell", { command: "deploy.sh" }, "moderate", "deploy");
      let finishExecution!: (result: { content: string }) => void;
      executeTool.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishExecution = resolve;
          }),
      );
      const { res, result } = mockResponse();

      const response = handleApproveApproval(
        mockRequest(approvalDecisionBody(queue, item.id)),
        res,
        item.id,
        null,
        queue,
      );
      await vi.waitFor(() => {
        expect(queue.get(item.id)?.status).toBe("approved");
        expect(listActiveApprovalExecutionIds(queue)).toEqual([item.id]);
      });

      finishExecution({ content: "ok" });
      await response;

      expect(result.status).toBe(200);
      expect(listActiveApprovalExecutionIds(queue)).toEqual([]);
    });
  });

  describe("handleRejectApproval", () => {
    it("rejects a pending item and returns it", async () => {
      const item = queue.enqueue("git", { args: ["reset", "--hard"] }, "dangerous", "reset");

      const { res, result } = mockResponse();
      await handleRejectApproval(mockRequest(), res, item.id, null, queue);
      expect(result.status).toBe(200);
      const body = result.body as { approval: { id: string; status: string } };
      expect(body.approval.id).toBe(item.id);
      expect(body.approval.status).toBe("rejected");
    });

    it("passes rejection reason from request body", async () => {
      const item = queue.enqueue("shell", { command: "reboot" }, "dangerous", "system reboot");

      const { res, result } = mockResponse();
      await handleRejectApproval(mockRequest({ reason: "not now" }), res, item.id, null, queue);
      expect(result.status).toBe(200);
      const body = result.body as { approval: { rejectionReason: string } };
      expect(body.approval.rejectionReason).toBe("not now");
    });

    it("rejects without reason when body is empty", async () => {
      const item = queue.enqueue("shell", { command: "echo" }, "safe", "simple command");

      const { res, result } = mockResponse();
      await handleRejectApproval(mockRequest({}), res, item.id, null, queue);
      expect(result.status).toBe(200);
      const body = result.body as { approval: { status: string; rejectionReason?: string } };
      expect(body.approval.status).toBe("rejected");
      expect(body.approval.rejectionReason).toBeUndefined();
    });

    it("returns 404 for unknown id", async () => {
      const { res, result } = mockResponse();
      await handleRejectApproval(mockRequest(), res, "deadbeef", null, queue);
      expect(result.status).toBe(404);
    });

    it("returns 400 for malformed decoded ids without mutating the queue", async () => {
      const item = queue.enqueue("git", { args: ["reset", "--hard"] }, "dangerous", "reset");

      const { res, result } = mockResponse();
      await handleRejectApproval(mockRequest(), res, `../${item.id}`, null, queue);

      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ reason: "invalid_approval_id" });
      expect(queue.get(item.id)?.status).toBe("pending");
    });
  });

  describe("handleApproveAllApprovals", () => {
    it("does not approve an item added after the operator reviewed the batch", async () => {
      queue.enqueue("shell", { command: "a.sh" }, "moderate", "task a");
      const reviewed = approvalBatchDecisionBody(queue);
      const added = queue.enqueue("shell", { command: "b.sh" }, "moderate", "task b");
      const { res, result } = mockResponse();

      await handleApproveAllApprovals(mockRequest(reviewed), res, null, queue);

      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({ reason: "approval_review_digest_mismatch" });
      expect(queue.get(added.id)?.status).toBe("pending");
      expect(queue.list("approved")).toEqual([]);
      expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
    });

    it("approves all pending items and returns them", async () => {
      queue.enqueue("shell", { command: "a.sh" }, "moderate", "task a");
      queue.enqueue("shell", { command: "b.sh" }, "moderate", "task b");

      const { res, result } = mockResponse();
      await handleApproveAllApprovals(
        mockRequest(approvalBatchDecisionBody(queue)),
        res,
        null,
        queue,
      );
      expect(result.status).toBe(200);
      const body = result.body as {
        approvals: Array<{ status: string }>;
        count: number;
        resolutions: Array<{
          approvalId: string;
          resolution: { kind: string; execution: { status: string } };
        }>;
      };
      expect(body.count).toBe(2);
      expect(body.approvals.every((a) => a.status === "approved")).toBe(true);
      expect(body.resolutions).toHaveLength(2);
      expect(
        body.resolutions.every(
          (entry) =>
            entry.resolution.kind === "tool_execution" &&
            entry.resolution.execution.status === "succeeded",
        ),
      ).toBe(true);
      expect(vi.mocked(executeTool)).toHaveBeenCalledTimes(2);
    });

    it("fails closed without executing approve-all when any pending input is unavailable", async () => {
      const dir = mkdtempSync(join(tmpdir(), "kota-approvals-route-restart-all-"));
      try {
        const original = new ApprovalQueue(dir);
        const unavailable = original.enqueue("shell", { command: "old" }, "moderate", "old");
        const restarted = new ApprovalQueue(dir);
        const available = restarted.enqueue("shell", { command: "new" }, "moderate", "new");

        const { res, result } = mockResponse();
        await handleApproveAllApprovals(mockRequest({ reviews: [] }), res, null, restarted);

        expect(result.status).toBe(409);
        expect(result.body).toMatchObject({
          reason: "approval_input_unavailable",
          approvals: [{ id: unavailable.id }],
        });
        expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
        expect(restarted.get(unavailable.id)?.status).toBe("pending");
        expect(restarted.get(available.id)?.status).toBe("pending");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("returns empty list when no pending approvals", async () => {
      const { res, result } = mockResponse();
      await handleApproveAllApprovals(mockRequest({ reviews: [] }), res, null, queue);
      expect(result.status).toBe(200);
      const body = result.body as { approvals: unknown[]; count: number };
      expect(body.count).toBe(0);
      expect(body.approvals).toEqual([]);
    });

    it("uses daemon client when available", async () => {
      const approvals = [{ id: "a1", tool: "shell", status: "approved" }];
      const link = mockTransport({ approvals, count: 1 });
      const { res, result } = mockResponse();
      await handleApproveAllApprovals(mockRequest({ reviews: [] }), res, link, makeQueue());
      expect(result.status).toBe(200);
      expect((result.body as { count: number }).count).toBe(1);
      expect(link.fetchRaw).toHaveBeenCalledWith("/approvals/approve-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviews: [] }),
      });
    });
  });

  describe("handleRejectAllApprovals", () => {
    it("rejects all pending items and returns them", async () => {
      queue.enqueue("git", { args: ["reset"] }, "dangerous", "reset");
      queue.enqueue("git", { args: ["push", "--force"] }, "dangerous", "force push");

      const { res, result } = mockResponse();
      await handleRejectAllApprovals(mockRequest(), res, null, queue);
      expect(result.status).toBe(200);
      const body = result.body as { approvals: Array<{ status: string }>; count: number };
      expect(body.count).toBe(2);
      expect(body.approvals.every((a) => a.status === "rejected")).toBe(true);
    });

    it("returns empty list when no pending approvals", async () => {
      const { res, result } = mockResponse();
      await handleRejectAllApprovals(mockRequest(), res, null, queue);
      expect(result.status).toBe(200);
      const body = result.body as { approvals: unknown[]; count: number };
      expect(body.count).toBe(0);
    });
  });
});
