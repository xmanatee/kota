import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { executeTool } from "#core/tools/index.js";
import {
	handleApproveAllApprovals,
	handleApproveApproval,
	handleListApprovals,
	handleRejectAllApprovals,
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
		queue = makeQueue();
		vi.mocked(executeTool).mockResolvedValue({ content: "ok" });
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	describe("daemon client proxy", () => {
		it("handleListApprovals returns daemon response when client succeeds", async () => {
			const approvals = [{ id: "a1", tool: "shell", status: "pending" }];
			const link = mockTransport({ list: { approvals } });
			const { res, result } = mockResponse();
			await handleListApprovals(res, link, makeQueue());
			expect(result.status).toBe(200);
			expect((result.body as { approvals: unknown[] }).approvals).toEqual(approvals);
		});

		it("handleListApprovals falls back to direct read when client returns null", async () => {
			const link = mockTransport({ list: null });
			const q = makeQueue();
			q.enqueue("shell", { command: "echo" }, "safe", "test");
			const { res, result } = mockResponse();
			await handleListApprovals(res, link, q);
			expect(result.status).toBe(200);
			expect((result.body as { approvals: unknown[] }).approvals).toHaveLength(1);
		});

		it("handleApproveApproval returns daemon response when client succeeds", async () => {
			const approval = { id: "abcd1234", tool: "shell", status: "approved" };
			const link = mockTransport({ approve: { approval } });
			const { res, result } = mockResponse();
			await handleApproveApproval(mockRequest(), res, "abcd1234", link, makeQueue());
			expect(result.status).toBe(200);
			expect((result.body as { approval: unknown }).approval).toEqual(approval);
		});

		it("handleApproveApproval relays daemon 409 without falling back to a local approval", async () => {
			const item = queue.enqueue("shell", { command: "deploy.sh" }, "moderate", "deploy");
			const link = mockTransport({
				approve: new Response(
					JSON.stringify({
						error: "Approval input is unavailable after daemon restart",
						reason: "approval_input_unavailable",
						approvals: [{ id: item.id }],
					}),
					{ status: 409, headers: { "Content-Type": "application/json" } },
				),
			});
			const { res, result } = mockResponse();

			await handleApproveApproval(mockRequest(), res, item.id, link, queue);

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

			await handleApproveApproval(mockRequest(), res, item.id, link, queue);

			expect(result.status).toBe(502);
			expect(result.body).toMatchObject({ reason: "daemon_transport_failed" });
			expect(queue.get(item.id)?.status).toBe("pending");
			expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
		});

		it("handleRejectApproval returns daemon response when client succeeds", async () => {
			const approval = { id: "abcd1234", tool: "shell", status: "rejected" };
			const link = mockTransport({ reject: { approval } });
			const { res, result } = mockResponse();
			await handleRejectApproval(mockRequest(), res, "abcd1234", link, makeQueue());
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

		it("does not return non-pending approvals", async () => {
			const item = queue.enqueue("shell", { command: "echo hi" }, "safe", "safe echo");
			queue.approve(item.id);

			const { res, result } = mockResponse();
			await handleListApprovals(res, null, queue);
			expect(result.status).toBe(200);
			const body = result.body as { approvals: unknown[] };
			expect(body.approvals).toHaveLength(0);
		});

		it("returns every status when status filter is 'all'", async () => {
			const a = queue.enqueue("shell", { command: "ok" }, "safe", "ok");
			queue.approve(a.id);
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
			queue.approve(b.id);

			const { res, result } = mockResponse();
			await handleListApprovals(res, null, queue, "approved");
			expect(result.status).toBe(200);
			const body = result.body as { approvals: Array<{ status: string }> };
			expect(body.approvals).toHaveLength(1);
			expect(body.approvals[0].status).toBe("approved");
		});

		it("forwards the status filter to the daemon client when one is configured", async () => {
			const filter: { capturedStatus?: string } = {};
			const link = mockTransport({ list: { approvals: [] }, listFilter: filter });
			const { res, result } = mockResponse();
			await handleListApprovals(res, link, makeQueue(), "all");
			expect(result.status).toBe(200);
			expect(filter.capturedStatus).toBe("all");
		});
	});

	describe("handleApproveApproval", () => {
		it("approves a pending item and returns it", async () => {
			const item = queue.enqueue(
				"shell",
				{ command: "deploy.sh", accessToken: "raw-token" },
				"moderate",
				"deploy",
			);
			vi.mocked(executeTool).mockResolvedValueOnce({ content: "deployed raw-token" });

			const { res, result } = mockResponse();
			await handleApproveApproval(mockRequest(), res, item.id, null, queue);
			expect(result.status).toBe(200);
			const body = result.body as {
				approval: { id: string; status: string; input: Record<string, unknown> };
				execution: { status: string; output: { redacted: true; reason: string } };
			};
			expect(body.approval.id).toBe(item.id);
			expect(body.approval.status).toBe("approved");
			expect(body.approval.input).toMatchObject({ redacted: true, reason: "tool-io" });
			expect(body.execution).toMatchObject({
				status: "succeeded",
				output: { redacted: true, reason: "tool-io" },
			});
			expect(vi.mocked(executeTool)).toHaveBeenCalledWith(
				"shell",
				{ command: "deploy.sh", accessToken: "raw-token" },
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
				await handleApproveApproval(mockRequest(), res, item.id, null, restarted);

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
			await handleApproveApproval(mockRequest(), res, "deadbeef", null, queue);
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
		it("approves all pending items and returns them", async () => {
			queue.enqueue("shell", { command: "a.sh" }, "moderate", "task a");
			queue.enqueue("shell", { command: "b.sh" }, "moderate", "task b");

			const { res, result } = mockResponse();
			await handleApproveAllApprovals(mockRequest(), res, null, queue);
			expect(result.status).toBe(200);
			const body = result.body as {
				approvals: Array<{ status: string }>;
				count: number;
				executions: Array<{ approvalId: string; execution: { status: string } }>;
			};
			expect(body.count).toBe(2);
			expect(body.approvals.every((a) => a.status === "approved")).toBe(true);
			expect(body.executions).toHaveLength(2);
			expect(body.executions.every((entry) => entry.execution.status === "succeeded")).toBe(true);
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
				await handleApproveAllApprovals(mockRequest(), res, null, restarted);

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
			await handleApproveAllApprovals(mockRequest(), res, null, queue);
			expect(result.status).toBe(200);
			const body = result.body as { approvals: unknown[]; count: number };
			expect(body.count).toBe(0);
			expect(body.approvals).toEqual([]);
		});

		it("uses daemon client when available", async () => {
			const approvals = [{ id: "a1", tool: "shell", status: "approved" }];
			const link = mockTransport({ approveAll: { approvals, count: 1 } });
			const { res, result } = mockResponse();
			await handleApproveAllApprovals(mockRequest(), res, link, makeQueue());
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
