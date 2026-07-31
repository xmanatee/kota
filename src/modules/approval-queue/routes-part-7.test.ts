import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { ToolRunner } from "#core/tools/index.js";
import {
	clearApprovalExecutionTestTools,
	registerApprovalExecutionTestTools,
} from "./approval-execution-test-tools.integration.js";
import {
	handleApproveAllApprovals,
	handleApproveApproval,
	handleListApprovals,
	handleRejectAllApprovals,
	handleRejectApproval,
} from "./routes.js";

const executeTool = vi.fn<ToolRunner>();

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

function reviewDigest(queue: ApprovalQueue, id: string): string {
	const item = queue.get(id);
	if (!item) throw new Error(`Missing approval ${id}`);
	const review = queue.projectForClient(item).review;
	if (review.status !== "available") throw new Error(`Approval ${id} is not reviewable`);
	return review.digest;
}

function approvalDecisionBody(
	queue: ApprovalQueue,
	id: string,
	note?: string,
): Record<string, unknown> {
	return {
		reviewDigest: reviewDigest(queue, id),
		...(note !== undefined ? { note } : {}),
	};
}

function approvalBatchDecisionBody(queue: ApprovalQueue): Record<string, unknown> {
	return {
		reviews: queue.list("pending").map((item) => ({
			id: item.id,
			digest: reviewDigest(queue, item.id),
		})),
	};
}

function approvePending(queue: ApprovalQueue, id: string): void {
	const selection = queue.getExecutionSnapshot(id);
	if (!selection.ok) throw new Error("expected execution snapshot");
	const result = queue.approveForExecution(selection.snapshot.descriptor);
	if (!result.ok) throw new Error("expected execution approval");
}

type RouteResponseSpec = {
	list?: { approvals: unknown[] } | null;
	approve?: unknown | null;
	reject?: unknown | null;
	approveAll?: unknown | null;
	rejectAll?: unknown | null;
	listFilter?: { capturedStatus?: string };
};

function mockTransport(spec: RouteResponseSpec = {}): import("#core/server/daemon-transport.js").DaemonTransport {
	return {
		baseUrl: "http://127.0.0.1:0",
		authHeaders: () => ({}),
		request: async <T,>(method: string, path: string, _body?: unknown) => {
			if (method === "GET" && path.startsWith("/approvals")) {
				const url = new URL(path, "http://127.0.0.1");
				if (spec.listFilter) spec.listFilter.capturedStatus = url.searchParams.get("status") ?? undefined;
				return ("list" in spec ? spec.list : null) as T | null;
			}
			if (method === "POST" && /\/approvals\/[^/]+\/approve$/.test(path)) {
				return ("approve" in spec ? spec.approve : null) as T | null;
			}
			if (method === "POST" && /\/approvals\/[^/]+\/reject$/.test(path)) {
				return ("reject" in spec ? spec.reject : null) as T | null;
			}
			if (method === "POST" && path === "/approvals/approve-all") {
				return ("approveAll" in spec ? spec.approveAll : null) as T | null;
			}
			if (method === "POST" && path === "/approvals/reject-all") {
				return ("rejectAll" in spec ? spec.rejectAll : null) as T | null;
			}
			return null;
		},
		requestStrict: async () => {
			throw new Error("requestStrict not configured for tests");
		},
		fetchRaw: async (path: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			let value: unknown | null = null;
			if (method === "POST" && /^\/approvals\/[^/]+\/approve(?:\?|$)/.test(path)) {
				value = "approve" in spec ? spec.approve : null;
			} else if (method === "POST" && /^\/approvals\/[^/]+\/reject(?:\?|$)/.test(path)) {
				value = "reject" in spec ? spec.reject : null;
			} else if (method === "POST" && /^\/approvals\/approve-all(?:\?|$)/.test(path)) {
				value = "approveAll" in spec ? spec.approveAll : null;
			} else if (method === "POST" && /^\/approvals\/reject-all(?:\?|$)/.test(path)) {
				value = "rejectAll" in spec ? spec.rejectAll : null;
			}
			if (value === null) {
				return new Response(JSON.stringify({ error: "not found" }), {
					status: 404,
					headers: { "Content-Type": "application/json" },
				});
			}
			if (value instanceof Response) return value;
			return new Response(JSON.stringify(value), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		},
		events: async function* () {
			// no events
		},
	};
}

describe("approval-routes", () => {
	let queue: ApprovalQueue;

	beforeEach(() => {
		registerApprovalExecutionTestTools(executeTool);
		queue = makeQueue();
		executeTool.mockResolvedValue({ content: "ok" });
	});

	afterEach(() => {
		clearApprovalExecutionTestTools();
		vi.restoreAllMocks();
		vi.clearAllMocks();
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
			expect(body.resolutions.every(
				(entry) =>
					entry.resolution.kind === "tool_execution"
					&& entry.resolution.execution.status === "succeeded",
			)).toBe(true);
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
				await handleApproveAllApprovals(
					mockRequest({ reviews: [] }),
					res,
					null,
					restarted,
				);

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
			const link = mockTransport({ approveAll: { approvals, count: 1 } });
			const { res, result } = mockResponse();
			await handleApproveAllApprovals(mockRequest({ reviews: [] }), res, link, makeQueue());
			expect(result.status).toBe(200);
			expect((result.body as { count: number }).count).toBe(1);
		});});

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
		});});});
