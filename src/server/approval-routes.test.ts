import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue } from "../modules/approval-queue/queue.js";
import {
	handleApproveAllApprovals,
	handleApproveApproval,
	handleListApprovals,
	handleRejectAllApprovals,
	handleRejectApproval,
} from "./approval-routes.js";

function makeQueue(): ApprovalQueue {
	const dir = join(tmpdir(), `kota-approvals-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	return new ApprovalQueue(dir);
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

function mockRequest(body: Record<string, unknown> = {}): IncomingMessage {
	const buf = Buffer.from(JSON.stringify(body));
	let dataHandler: ((chunk: Buffer) => void) | null = null;
	let endHandler: (() => void) | null = null;
	const req = {
		headers: { "content-type": "application/json" },
		on: (event: string, cb: (data?: Buffer) => void) => {
			if (event === "data") dataHandler = cb as (chunk: Buffer) => void;
			if (event === "end") endHandler = cb as () => void;
			if (event === "error") {
				/* noop */
			}
			// emit synchronously after both handlers registered
			if (dataHandler && endHandler) {
				dataHandler(buf);
				endHandler();
				dataHandler = null;
				endHandler = null;
			}
		},
	};
	return req as unknown as IncomingMessage;
}

function mockClient(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		listApprovals: vi.fn(async () => null),
		approveApproval: vi.fn(async () => null),
		rejectApproval: vi.fn(async () => null),
		approveAllApprovals: vi.fn(async () => null),
		rejectAllApprovals: vi.fn(async () => null),
		...overrides,
	} as unknown as import("./daemon-client.js").DaemonControlClient;
}

describe("approval-routes", () => {
	let queue: ApprovalQueue;

	beforeEach(() => {
		queue = makeQueue();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("daemon client proxy", () => {
		it("handleListApprovals returns daemon response when client succeeds", async () => {
			const approvals = [{ id: "a1", tool: "shell", status: "pending" }];
			const client = mockClient({ listApprovals: vi.fn(async () => ({ approvals })) });
			const { res, result } = mockResponse();
			await handleListApprovals(res, client, makeQueue());
			expect(result.status).toBe(200);
			expect((result.body as { approvals: unknown[] }).approvals).toEqual(approvals);
		});

		it("handleListApprovals falls back to direct read when client returns null", async () => {
			const client = mockClient({ listApprovals: vi.fn(async () => null) });
			const q = makeQueue();
			q.enqueue("shell", { command: "echo" }, "safe", "test");
			const { res, result } = mockResponse();
			await handleListApprovals(res, client, q);
			expect(result.status).toBe(200);
			expect((result.body as { approvals: unknown[] }).approvals).toHaveLength(1);
		});

		it("handleApproveApproval returns daemon response when client succeeds", async () => {
			const approval = { id: "a1", tool: "shell", status: "approved" };
			const client = mockClient({ approveApproval: vi.fn(async () => ({ approval })) });
			const { res, result } = mockResponse();
			await handleApproveApproval(mockRequest(), res, "a1", client, makeQueue());
			expect(result.status).toBe(200);
			expect((result.body as { approval: unknown }).approval).toEqual(approval);
		});

		it("handleRejectApproval returns daemon response when client succeeds", async () => {
			const approval = { id: "a1", tool: "shell", status: "rejected" };
			const client = mockClient({ rejectApproval: vi.fn(async () => ({ approval })) });
			const { res, result } = mockResponse();
			await handleRejectApproval(mockRequest(), res, "a1", client, makeQueue());
			expect(result.status).toBe(200);
			expect((result.body as { approval: unknown }).approval).toEqual(approval);
		});
	});

	describe("handleListApprovals", () => {
		it("returns empty list when no pending approvals", async () => {
			const { res, result } = mockResponse();
			await handleListApprovals(res, null, queue);
			expect(result.status).toBe(200);
			const body = result.body as { approvals: unknown[] };
			expect(body.approvals).toEqual([]);
		});

		it("returns pending approvals", async () => {
			queue.enqueue("shell", { command: "rm -rf /tmp/foo" }, "dangerous", "cleanup script");
			queue.enqueue("git", { args: ["push", "--force"] }, "dangerous", "force push");

			const { res, result } = mockResponse();
			await handleListApprovals(res, null, queue);
			expect(result.status).toBe(200);
			const body = result.body as { approvals: Array<{ tool: string; status: string }> };
			expect(body.approvals).toHaveLength(2);
			expect(body.approvals[0].tool).toBe("shell");
			expect(body.approvals[0].status).toBe("pending");
			expect(body.approvals[1].tool).toBe("git");
		});

		it("does not return non-pending approvals", async () => {
			const item = queue.enqueue("shell", { command: "echo hi" }, "safe", "safe echo");
			queue.approve(item.id);

			const { res, result } = mockResponse();
			await handleListApprovals(res, null, queue);
			expect(result.status).toBe(200);
			const body = result.body as { approvals: unknown[] };
			expect(body.approvals).toHaveLength(0);
		});
	});

	describe("handleApproveApproval", () => {
		it("approves a pending item and returns it", async () => {
			const item = queue.enqueue("shell", { command: "deploy.sh" }, "moderate", "deploy");

			const { res, result } = mockResponse();
			await handleApproveApproval(mockRequest(), res, item.id, null, queue);
			expect(result.status).toBe(200);
			const body = result.body as { approval: { id: string; status: string } };
			expect(body.approval.id).toBe(item.id);
			expect(body.approval.status).toBe("approved");
		});

		it("stores note from request body when provided", async () => {
			const item = queue.enqueue("shell", { command: "deploy.sh" }, "moderate", "deploy");

			const { res, result } = mockResponse();
			await handleApproveApproval(mockRequest({ note: "please add a unit test" }), res, item.id, null, queue);
			expect(result.status).toBe(200);
			const body = result.body as { approval: { approvalNote: string } };
			expect(body.approval.approvalNote).toBe("please add a unit test");
		});

		it("approves without note when body omits it", async () => {
			const item = queue.enqueue("shell", { command: "deploy.sh" }, "moderate", "deploy");

			const { res, result } = mockResponse();
			await handleApproveApproval(mockRequest({}), res, item.id, null, queue);
			expect(result.status).toBe(200);
			const body = result.body as { approval: { status: string; approvalNote?: string } };
			expect(body.approval.status).toBe("approved");
			expect(body.approval.approvalNote).toBeUndefined();
		});

		it("returns 404 for unknown id", async () => {
			const { res, result } = mockResponse();
			await handleApproveApproval(mockRequest(), res, "nonexistent", null, queue);
			expect(result.status).toBe(404);
		});

		it("returns 404 when item is not pending", async () => {
			const item = queue.enqueue("shell", { command: "echo" }, "safe", "already approved");
			queue.approve(item.id);

			const { res, result } = mockResponse();
			await handleApproveApproval(mockRequest(), res, item.id, null, queue);
			expect(result.status).toBe(404);
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
			await handleRejectApproval(mockRequest(), res, "nonexistent", null, queue);
			expect(result.status).toBe(404);
		});
	});

	describe("handleApproveAllApprovals", () => {
		it("approves all pending items and returns them", async () => {
			queue.enqueue("shell", { command: "a.sh" }, "moderate", "task a");
			queue.enqueue("shell", { command: "b.sh" }, "moderate", "task b");

			const { res, result } = mockResponse();
			await handleApproveAllApprovals(mockRequest(), res, null, queue);
			expect(result.status).toBe(200);
			const body = result.body as { approvals: Array<{ status: string }>; count: number };
			expect(body.count).toBe(2);
			expect(body.approvals.every((a) => a.status === "approved")).toBe(true);
		});

		it("returns empty list when no pending approvals", async () => {
			const { res, result } = mockResponse();
			await handleApproveAllApprovals(mockRequest(), res, null, queue);
			expect(result.status).toBe(200);
			const body = result.body as { approvals: unknown[]; count: number };
			expect(body.count).toBe(0);
			expect(body.approvals).toEqual([]);
		});

		it("uses daemon client when available", async () => {
			const approvals = [{ id: "a1", tool: "shell", status: "approved" }];
			const client = mockClient({ approveAllApprovals: vi.fn(async () => ({ approvals, count: 1 })) });
			const { res, result } = mockResponse();
			await handleApproveAllApprovals(mockRequest(), res, client, makeQueue());
			expect(result.status).toBe(200);
			expect((result.body as { count: number }).count).toBe(1);
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
