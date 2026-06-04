import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { ApprovalQueue, getApprovalQueue, isApprovalId, resetApprovalQueue } from "./approval-queue.js";

describe("ApprovalQueue", () => {
	let dir: string;
	let queue: ApprovalQueue;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "approval-test-"));
		queue = new ApprovalQueue(dir);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("enqueues and retrieves an item", () => {
		const item = queue.enqueue("shell", { command: "rm -rf /tmp" }, "dangerous", "destructive command");
		expect(item.id).toHaveLength(8);
		expect(item.tool).toBe("shell");
		expect(item.status).toBe("pending");
		expect(item.risk).toBe("dangerous");

		const retrieved = queue.get(item.id);
		expect(retrieved).toEqual(item);
	});

	it("returns null for valid but nonexistent ids", () => {
		expect(queue.get("deadbeef")).toBeNull();
	});

	it("generates ids that match the approval id boundary", () => {
		const item = queue.enqueue("shell", { command: "echo ok" }, "safe", "test");
		expect(isApprovalId(item.id)).toBe(true);
	});

	it("rejects malformed ids before resolving approval file paths", () => {
		const siblingId = `approval-sibling-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const siblingPath = join(dir, "..", `${siblingId}.json`);
		const sibling = {
			id: siblingId,
			tool: "shell",
			input: { command: "echo should-not-run" },
			risk: "moderate",
			reason: "sibling record",
			createdAt: new Date().toISOString(),
			status: "pending",
		};
		writeFileSync(siblingPath, JSON.stringify(sibling, null, 2));

		try {
			expect(queue.get(`../${siblingId}`)).toBeNull();
			expect(queue.approve(`../${siblingId}`)).toBeNull();
			expect(queue.reject(`../${siblingId}`)).toBeNull();
			expect(JSON.parse(readFileSync(siblingPath, "utf-8"))).toEqual(sibling);
		} finally {
			unlinkSync(siblingPath);
		}
	});

	it("lists pending items", () => {
		queue.enqueue("shell", { command: "rm a" }, "dangerous", "reason1");
		queue.enqueue("git", { command: "git push" }, "dangerous", "reason2");
		const items = queue.list("pending");
		expect(items).toHaveLength(2);
		const tools = new Set(items.map((i) => i.tool));
		expect(tools).toContain("shell");
		expect(tools).toContain("git");
	});

	it("list returns all statuses when no filter", () => {
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		queue.approve(item.id);
		queue.enqueue("git", { command: "push" }, "dangerous", "reason2");

		const all = queue.list();
		expect(all).toHaveLength(2);
		const pending = queue.list("pending");
		expect(pending).toHaveLength(1);
		expect(pending[0].tool).toBe("git");
	});

	it("approves a pending item", () => {
		const item = queue.enqueue("shell", { command: "sudo apt" }, "dangerous", "sudo detected");
		const approved = queue.approve(item.id);
		expect(approved).not.toBeNull();
		expect(approved!.status).toBe("approved");
		expect(approved!.resolvedAt).toBeDefined();

		const retrieved = queue.get(item.id);
		expect(retrieved!.status).toBe("approved");
	});

	it("rejects a pending item with reason", () => {
		const item = queue.enqueue("shell", { command: "rm -rf /" }, "dangerous", "destructive");
		const rejected = queue.reject(item.id, "too dangerous");
		expect(rejected).not.toBeNull();
		expect(rejected!.status).toBe("rejected");
		expect(rejected!.rejectionReason).toBe("too dangerous");
	});

	it("cannot approve an already resolved item", () => {
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		queue.approve(item.id);
		expect(queue.approve(item.id)).toBeNull();
	});

	it("cannot reject an already resolved item", () => {
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		queue.reject(item.id);
		expect(queue.reject(item.id)).toBeNull();
	});

	it("counts pending items", () => {
		queue.enqueue("shell", { command: "a" }, "dangerous", "r");
		queue.enqueue("shell", { command: "b" }, "dangerous", "r");
		const third = queue.enqueue("shell", { command: "c" }, "dangerous", "r");
		queue.approve(third.id);

		expect(queue.count("pending")).toBe(2);
		expect(queue.count("approved")).toBe(1);
		expect(queue.count()).toBe(3);
	});

	it("clears all items", () => {
		queue.enqueue("shell", { command: "a" }, "dangerous", "r");
		queue.enqueue("shell", { command: "b" }, "dangerous", "r");
		queue.clear();
		expect(queue.list()).toHaveLength(0);
	});

	it("stores source in enqueued item", () => {
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", "session-123");
		expect(item.source).toBe("session-123");
	});

	it("stores session id in enqueued item when provided", () => {
		const item = queue.enqueue(
			"shell",
			{ command: "rm" },
			"dangerous",
			"reason",
			"session-123",
			undefined,
			undefined,
			undefined,
			"session-123",
		);
		expect(item.sessionId).toBe("session-123");
		expect(queue.get(item.id)!.sessionId).toBe("session-123");
	});

	it("stores context in enqueued item when provided", () => {
		const ctx = "User: delete temp files\nAssistant: I will remove /tmp/old";
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, undefined, undefined, ctx);
		expect(item.context).toBe(ctx);
		expect(queue.get(item.id)!.context).toBe(ctx);
	});

	it("does not store context when not provided", () => {
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		expect(item.context).toBeUndefined();
	});

	describe("expireStale", () => {
		function backdate(id: string, ageMs: number): void {
			const stored = queue.get(id)!;
			stored.createdAt = new Date(Date.now() - ageMs).toISOString();
			writeFileSync(join(dir, `${id}.json`), JSON.stringify(stored, null, 2));
		}

		it("expires pending items older than ttl", () => {
			const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			backdate(item.id, 2000);

			const expired = queue.expireStale(1000);
			expect(expired).toHaveLength(1);
			expect(expired[0].status).toBe("expired");
			expect(expired[0].rejectionReason).toBe("expired");
			expect(expired[0].resolvedAt).toBeDefined();
		});

		it("does not expire items within ttl", () => {
			queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			const expired = queue.expireStale(60_000);
			expect(expired).toHaveLength(0);
		});

		it("does not expire already-resolved items", () => {
			const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			queue.reject(item.id);
			backdate(item.id, 2000);

			const expired = queue.expireStale(1000);
			expect(expired).toHaveLength(0);
			expect(queue.get(item.id)!.status).toBe("rejected");
		});

		it("expired items persist in queue with expired status", () => {
			const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			backdate(item.id, 2000);

			queue.expireStale(1000);
			expect(queue.get(item.id)!.status).toBe("expired");
		});

		it("expired items are excluded from pending list", () => {
			const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			backdate(item.id, 2000);

			queue.expireStale(1000);
			expect(queue.list("pending")).toHaveLength(0);
			expect(queue.list("expired")).toHaveLength(1);
		});

		it("expires item using per-item timeoutMs when no defaultTtlMs provided", () => {
			const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 1000);
			backdate(item.id, 2000);

			const expired = queue.expireStale();
			expect(expired).toHaveLength(1);
			expect(expired[0].status).toBe("expired");
		});

		it("per-item timeoutMs takes precedence over defaultTtlMs", () => {
			// item has 500ms timeout, but global TTL is 10 minutes
			const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 500);
			backdate(item.id, 2000);

			const expired = queue.expireStale(600_000);
			expect(expired).toHaveLength(1);
			expect(queue.get(item.id)!.timeoutMs).toBe(500);
		});

		it("skips items with no TTL when defaultTtlMs is undefined", () => {
			queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			const expired = queue.expireStale();
			expect(expired).toHaveLength(0);
		});

		it("stores timeoutMs on enqueued item", () => {
			const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 5000);
			expect(item.timeoutMs).toBe(5000);
			expect(queue.get(item.id)!.timeoutMs).toBe(5000);
		});

		it("does not store timeoutMs when not provided", () => {
			const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			expect(item.timeoutMs).toBeUndefined();
		});

		it("auto-deny (default): expired status and rejectionReason set", () => {
			const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 1000);
			backdate(item.id, 2000);
			const result = queue.expireStale();
			expect(result[0].status).toBe("expired");
			expect(result[0].rejectionReason).toBe("expired");
			expect(result[0].resolutionSource).toBe("timeout");
		});

		it("auto-approve: approved status when defaultResolution is approve", () => {
			const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 1000, "approve");
			backdate(item.id, 2000);
			const result = queue.expireStale();
			expect(result[0].status).toBe("approved");
			expect(result[0].rejectionReason).toBeUndefined();
			expect(result[0].resolutionSource).toBe("timeout");
		});

		it("stores defaultResolution on enqueued item", () => {
			const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 1000, "approve");
			expect(item.defaultResolution).toBe("approve");
			expect(queue.get(item.id)!.defaultResolution).toBe("approve");
		});

		it("does not store defaultResolution when not provided", () => {
			const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			expect(item.defaultResolution).toBeUndefined();
		});
	});
});

describe("approval.changed events", () => {
	let dir: string;
	let queue: ApprovalQueue;
	let received: Array<{ event: string; payload: Record<string, unknown> }>;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "approval-event-test-"));
		const bus = new EventBus();
		received = [];
		bus.on("*", (envelope) => {
			received.push({ event: envelope.type, payload: envelope.payload as Record<string, unknown> });
		});
		const pbus = new ProjectScopedEventBus(bus, "test-project");
		queue = new ApprovalQueue(dir, pbus);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("emits approval.changed on enqueue with pending count and id", () => {
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		const calls = received.filter(({ event }) => event === "approval.changed").map((r) => [r.event, r.payload]);
		expect(calls).toHaveLength(1);
			expect(calls[0][1]).toEqual({ scopeId: "test-project", projectId: "test-project", id: item.id, pendingCount: 1 });
	});

	it("emits approval.requested with source and session correlation", () => {
		const item = queue.enqueue(
			"shell",
			{ command: "rm" },
			"dangerous",
			"reason",
			"session-123",
			undefined,
			undefined,
			undefined,
			"session-123",
		);
		const calls = received.filter(({ event }) => event === "approval.requested").map((r) => [r.event, r.payload]);
		expect(calls).toHaveLength(1);
		expect(calls[0][1]).toMatchObject({
			projectId: "test-project",
			id: item.id,
			source: "session-123",
			sessionId: "session-123",
		});
	});

	it("emits approval.changed on approve with decremented pending count", () => {
		queue.enqueue("shell", { command: "a" }, "dangerous", "r");
		const item2 = queue.enqueue("git", { command: "b" }, "dangerous", "r");
		received.length = 0;

		queue.approve(item2.id);
		const calls = received.filter(({ event }) => event === "approval.changed").map((r) => [r.event, r.payload]);
		expect(calls).toHaveLength(1);
			expect(calls[0][1]).toEqual({ scopeId: "test-project", projectId: "test-project", id: item2.id, pendingCount: 1 });
	});

	it("emits approval.resolved with source and session correlation", () => {
		const item = queue.enqueue(
			"shell",
			{ command: "rm" },
			"dangerous",
			"reason",
			"session-123",
			undefined,
			undefined,
			undefined,
			"session-123",
		);
		received.length = 0;

		queue.approve(item.id);
		const calls = received.filter(({ event }) => event === "approval.resolved").map((r) => [r.event, r.payload]);
		expect(calls).toHaveLength(1);
		expect(calls[0][1]).toMatchObject({
			projectId: "test-project",
			id: item.id,
			source: "session-123",
			sessionId: "session-123",
			approved: true,
		});
	});

	it("emits approval.changed on reject with decremented pending count", () => {
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		received.length = 0;

		queue.reject(item.id, "too risky");
		const calls = received.filter(({ event }) => event === "approval.changed").map((r) => [r.event, r.payload]);
		expect(calls).toHaveLength(1);
			expect(calls[0][1]).toEqual({ scopeId: "test-project", projectId: "test-project", id: item.id, pendingCount: 0 });
	});

	it("emits approval.changed on expireStale", () => {
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		const stored = queue.get(item.id)!;
		stored.createdAt = new Date(Date.now() - 5000).toISOString();
		writeFileSync(join(dir, `${item.id}.json`), JSON.stringify(stored, null, 2));
		received.length = 0;

		queue.expireStale(1000);
		const calls = received.filter(({ event }) => event === "approval.changed").map((r) => [r.event, r.payload]);
		expect(calls).toHaveLength(1);
			expect(calls[0][1]).toEqual({ scopeId: "test-project", projectId: "test-project", id: item.id, pendingCount: 0 });
	});

	it("emits approval.expired on expireStale", () => {
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		const stored = queue.get(item.id)!;
		stored.createdAt = new Date(Date.now() - 5000).toISOString();
		writeFileSync(join(dir, `${item.id}.json`), JSON.stringify(stored, null, 2));
		received.length = 0;

		queue.expireStale(1000);
		const calls = received.filter(({ event }) => event === "approval.expired").map((r) => [r.event, r.payload]);
		expect(calls).toHaveLength(1);
			expect(calls[0][1]).toEqual({ scopeId: "test-project", projectId: "test-project", id: item.id, tool: item.tool });
	});

	it("emits approval.expired for item with per-item timeoutMs", () => {
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 500);
		const stored = queue.get(item.id)!;
		stored.createdAt = new Date(Date.now() - 2000).toISOString();
		writeFileSync(join(dir, `${item.id}.json`), JSON.stringify(stored, null, 2));
		received.length = 0;

		queue.expireStale();
		const calls = received.filter(({ event }) => event === "approval.expired").map((r) => [r.event, r.payload]);
		expect(calls).toHaveLength(1);
			expect(calls[0][1]).toEqual({ scopeId: "test-project", projectId: "test-project", id: item.id, tool: item.tool });
	});

	it("emits workflow.approval.timeout on expireStale (auto-deny)", () => {
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 500);
		const stored = queue.get(item.id)!;
		stored.createdAt = new Date(Date.now() - 2000).toISOString();
		writeFileSync(join(dir, `${item.id}.json`), JSON.stringify(stored, null, 2));
		received.length = 0;

		queue.expireStale();
		const calls = received.filter(({ event }) => event === "workflow.approval.timeout").map((r) => [r.event, r.payload]);
		expect(calls).toHaveLength(1);
			expect(calls[0][1]).toEqual({ scopeId: "test-project", projectId: "test-project", id: item.id, tool: item.tool, defaultResolution: "deny" });
	});

	it("emits workflow.approval.timeout on expireStale (auto-approve)", () => {
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 500, "approve");
		const stored = queue.get(item.id)!;
		stored.createdAt = new Date(Date.now() - 2000).toISOString();
		writeFileSync(join(dir, `${item.id}.json`), JSON.stringify(stored, null, 2));
		received.length = 0;

		queue.expireStale();
		const calls = received.filter(({ event }) => event === "workflow.approval.timeout").map((r) => [r.event, r.payload]);
		expect(calls).toHaveLength(1);
			expect(calls[0][1]).toEqual({ scopeId: "test-project", projectId: "test-project", id: item.id, tool: item.tool, defaultResolution: "approve" });
	});

	it("emits approval.resolved with approved=true for auto-approve timeout", () => {
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 500, "approve");
		const stored = queue.get(item.id)!;
		stored.createdAt = new Date(Date.now() - 2000).toISOString();
		writeFileSync(join(dir, `${item.id}.json`), JSON.stringify(stored, null, 2));
		received.length = 0;

		queue.expireStale();
		const calls = received.filter(({ event }) => event === "approval.resolved").map((r) => [r.event, r.payload]);
		expect(calls).toHaveLength(1);
		expect(calls[0][1]).toMatchObject({ approved: true });
	});
});

describe("getApprovalQueue singleton", () => {
	afterEach(() => resetApprovalQueue());

	it("returns same instance on repeated calls", () => {
		const dir = mkdtempSync(join(tmpdir(), "approval-singleton-"));
		const q1 = getApprovalQueue(dir);
		const q2 = getApprovalQueue();
		expect(q1).toBe(q2);
		rmSync(dir, { recursive: true, force: true });
	});

	it("resets to new instance after resetApprovalQueue", () => {
		const dir1 = mkdtempSync(join(tmpdir(), "approval-reset1-"));
		const dir2 = mkdtempSync(join(tmpdir(), "approval-reset2-"));
		const q1 = getApprovalQueue(dir1);
		resetApprovalQueue();
		const q2 = getApprovalQueue(dir2);
		expect(q1).not.toBe(q2);
		rmSync(dir1, { recursive: true, force: true });
		rmSync(dir2, { recursive: true, force: true });
	});
});
