/**
 * Integration test: ApprovalQueue expiry × EventBus
 *
 * Verifies that approval.expired is emitted through the real event bus when
 * expireStale runs, with both global defaultTtlMs and per-item timeoutMs.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getEventBus, initEventBus, resetEventBus } from "./core/events/event-bus.js";
import { ApprovalQueue } from "./core/daemon/approval-queue.js";

describe("approval expiry × event bus integration", () => {
	let dir: string;
	let queue: ApprovalQueue;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "approval-expiry-integration-"));
		resetEventBus();
		initEventBus();
		queue = new ApprovalQueue(dir);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
		resetEventBus();
	});

	function backdate(id: string, ageMs: number): void {
		const stored = queue.get(id)!;
		stored.createdAt = new Date(Date.now() - ageMs).toISOString();
		writeFileSync(join(dir, `${id}.json`), JSON.stringify(stored, null, 2));
	}

	it("emits approval.expired on the bus when global TTL expires an item", () => {
		const bus = getEventBus()!;
		const received: unknown[] = [];
		bus.on("approval.expired", (payload) => received.push(payload));

		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		backdate(item.id, 2000);

		queue.expireStale(1000);

		expect(received).toHaveLength(1);
		expect(received[0]).toEqual({ id: item.id, tool: item.tool });
	});

	it("emits approval.expired on the bus when per-item timeoutMs expires", () => {
		const bus = getEventBus()!;
		const received: unknown[] = [];
		bus.on("approval.expired", (payload) => received.push(payload));

		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 500);
		backdate(item.id, 2000);

		// No defaultTtlMs — relies entirely on per-item timeout
		queue.expireStale();

		expect(received).toHaveLength(1);
		expect(received[0]).toEqual({ id: item.id, tool: item.tool });
	});

	it("does not emit approval.expired for items within TTL", () => {
		const bus = getEventBus()!;
		const received: unknown[] = [];
		bus.on("approval.expired", (payload) => received.push(payload));

		queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		// Do NOT backdate — item is fresh

		queue.expireStale(60_000);

		expect(received).toHaveLength(0);
	});

	it("emits workflow.approval.timeout on the bus for auto-deny", () => {
		const bus = getEventBus()!;
		const received: unknown[] = [];
		bus.on("workflow.approval.timeout", (payload) => received.push(payload));

		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		backdate(item.id, 2000);

		queue.expireStale(1000);

		expect(received).toHaveLength(1);
		expect(received[0]).toEqual({ id: item.id, tool: item.tool, defaultResolution: "deny" });
	});

	it("emits workflow.approval.timeout on the bus for auto-approve", () => {
		const bus = getEventBus()!;
		const received: unknown[] = [];
		bus.on("workflow.approval.timeout", (payload) => received.push(payload));

		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 500, "approve");
		backdate(item.id, 2000);

		queue.expireStale();

		expect(received).toHaveLength(1);
		expect(received[0]).toEqual({ id: item.id, tool: item.tool, defaultResolution: "approve" });
	});

	it("auto-approve path sets status to approved", () => {
		const bus = getEventBus()!;
		bus.on("workflow.approval.timeout", () => {});

		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 500, "approve");
		backdate(item.id, 2000);

		queue.expireStale();

		expect(queue.get(item.id)!.status).toBe("approved");
		expect(queue.get(item.id)!.resolutionSource).toBe("timeout");
	});
});
