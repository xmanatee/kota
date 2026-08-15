import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { executeTool } from "#core/tools/index.js";
import {
	handleRejectApproval,
} from "./routes.js";

vi.mock("#core/tools/index.js", () => ({
	executeTool: vi.fn(),
}));

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

function _approvalDecisionBody(
	queue: ApprovalQueue,
	id: string,
	note?: string,
): Record<string, unknown> {
	return {
		reviewDigest: reviewDigest(queue, id),
		...(note !== undefined ? { note } : {}),
	};
}

function _approvalBatchDecisionBody(queue: ApprovalQueue): Record<string, unknown> {
	return {
		reviews: queue.list("pending").map((item) => ({
			id: item.id,
			digest: reviewDigest(queue, item.id),
		})),
	};
}

function _approvePending(queue: ApprovalQueue, id: string): void {
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

function _mockTransport(spec: RouteResponseSpec = {}): import("#core/server/daemon-transport.js").DaemonTransport {
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
		queue = makeQueue();
		vi.mocked(executeTool).mockResolvedValue({ content: "ok" });
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
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
		});});});
