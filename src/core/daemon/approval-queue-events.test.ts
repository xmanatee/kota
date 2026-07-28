import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { ApprovalQueue } from "./approval-queue.js";

describe("approval events", () => {
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
		expect(calls[0][1]).toEqual({
			scopeId: "test-project",
			projectId: "test-project",
			id: item.id,
			pendingCount: 1,
		});
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
		expect(calls[0][1]).toEqual({
			scopeId: "test-project",
			projectId: "test-project",
			id: item2.id,
			pendingCount: 1,
		});
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

	it("emits observable events for snapshot approve-all execution", () => {
		const first = queue.enqueue("shell", { command: "a" }, "dangerous", "r", "session-a");
		const second = queue.enqueue("git", { command: "b" }, "dangerous", "r", "session-b");
		const queuedLater = queue.enqueue("shell", { command: "late" }, "moderate", "r", "session-late");
		received.length = 0;

		const firstSnapshot = queue.getExecutionSnapshot(first.id);
		const secondSnapshot = queue.getExecutionSnapshot(second.id);
		if (!firstSnapshot.ok || !secondSnapshot.ok) {
			throw new Error("expected execution snapshots");
		}
		const result = queue.approvePendingForExecution(
			[firstSnapshot.snapshot.descriptor, secondSnapshot.snapshot.descriptor],
			"operator reviewed snapshot",
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected approve-all snapshot to succeed");
		expect(result.approvals.map((approval) => approval.id)).toEqual([first.id, second.id]);
		expect(queue.get(queuedLater.id)?.status).toBe("pending");
		const resolved = received.filter(({ event }) => event === "approval.resolved").map(({ payload }) => payload);
		expect(resolved).toMatchObject([
			{ scopeId: "test-project", projectId: "test-project", id: first.id, approved: true, source: "session-a" },
			{ scopeId: "test-project", projectId: "test-project", id: second.id, approved: true, source: "session-b" },
		]);
		const changed = received.filter(({ event }) => event === "approval.changed").map(({ payload }) => payload);
		expect(changed).toEqual([
			{ scopeId: "test-project", projectId: "test-project", id: first.id, pendingCount: 2 },
			{ scopeId: "test-project", projectId: "test-project", id: second.id, pendingCount: 1 },
		]);
	});

	it("emits approval.changed on reject with decremented pending count", () => {
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		received.length = 0;

		queue.reject(item.id, "too risky");
		const calls = received.filter(({ event }) => event === "approval.changed").map((r) => [r.event, r.payload]);
		expect(calls).toHaveLength(1);
		expect(calls[0][1]).toEqual({
			scopeId: "test-project",
			projectId: "test-project",
			id: item.id,
			pendingCount: 0,
		});
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
		expect(calls[0][1]).toEqual({
			scopeId: "test-project",
			projectId: "test-project",
			id: item.id,
			pendingCount: 0,
		});
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
		expect(calls[0][1]).toEqual({
			scopeId: "test-project",
			projectId: "test-project",
			id: item.id,
			tool: item.tool,
		});
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
		expect(calls[0][1]).toEqual({
			scopeId: "test-project",
			projectId: "test-project",
			id: item.id,
			tool: item.tool,
		});
	});

	it("emits workflow.approval.timeout on expireStale (auto-deny)", () => {
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 500);
		const stored = queue.get(item.id)!;
		stored.createdAt = new Date(Date.now() - 2000).toISOString();
		writeFileSync(join(dir, `${item.id}.json`), JSON.stringify(stored, null, 2));
		received.length = 0;

		queue.expireStale();
		const calls = received
			.filter(({ event }) => event === "workflow.approval.timeout")
			.map((r) => [r.event, r.payload]);
		expect(calls).toHaveLength(1);
		expect(calls[0][1]).toEqual({
			scopeId: "test-project",
			projectId: "test-project",
			id: item.id,
			tool: item.tool,
			defaultResolution: "deny",
		});
	});

	it("emits workflow.approval.timeout on expireStale (auto-approve)", () => {
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 500, "approve");
		const stored = queue.get(item.id)!;
		stored.createdAt = new Date(Date.now() - 2000).toISOString();
		writeFileSync(join(dir, `${item.id}.json`), JSON.stringify(stored, null, 2));
		received.length = 0;

		queue.expireStale();
		const calls = received
			.filter(({ event }) => event === "workflow.approval.timeout")
			.map((r) => [r.event, r.payload]);
		expect(calls).toHaveLength(1);
		expect(calls[0][1]).toEqual({
			scopeId: "test-project",
			projectId: "test-project",
			id: item.id,
			tool: item.tool,
			defaultResolution: "approve",
		});
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
