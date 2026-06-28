import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApprovalQueue } from "./approval-queue.js";

describe("ApprovalQueue expireStale", () => {
	let dir: string;
	let queue: ApprovalQueue;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "approval-expire-test-"));
		queue = new ApprovalQueue(dir);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

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
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 500);
		backdate(item.id, 2000);

		const expired = queue.expireStale(600_000);
		expect(expired).toHaveLength(1);
		expect(queue.get(item.id)!.timeoutMs).toBe(500);
	});

	it("uses evidence-policy pending retention when defaultTtlMs is undefined", () => {
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		backdate(item.id, 25 * 60 * 60 * 1000);
		const expired = queue.expireStale();
		expect(expired).toHaveLength(1);
		expect(expired[0].status).toBe("expired");
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
