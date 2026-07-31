import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue } from "./approval-queue.js";

describe("ApprovalQueue expireStale", () => {
	let dir: string;
	let queue: ApprovalQueue;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-31T00:00:00.000Z"));
		dir = mkdtempSync(join(tmpdir(), "approval-expire-test-"));
		queue = new ApprovalQueue(dir);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
		vi.useRealTimers();
	});

	function agePendingApproval(ageMs: number): void {
		vi.advanceTimersByTime(ageMs);
	}

	it("expires pending items older than ttl", () => {
		queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		agePendingApproval(2000);

		const { expired, blocked } = queue.expireStale(1000);
		expect(expired).toHaveLength(1);
		expect(blocked).toHaveLength(0);
		expect(expired[0].status).toBe("expired");
		expect(expired[0].rejectionReason).toBe("expired");
		expect(expired[0].resolvedAt).toBeDefined();
	});

	it("does not expire items within ttl", () => {
		queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		const { expired, blocked } = queue.expireStale(60_000);
		expect(expired).toHaveLength(0);
		expect(blocked).toHaveLength(0);
	});

	it("does not expire already-resolved items", () => {
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		queue.reject(item.id);
		agePendingApproval(2000);

		const { expired, blocked } = queue.expireStale(1000);
		expect(expired).toHaveLength(0);
		expect(blocked).toHaveLength(0);
		expect(queue.get(item.id)!.status).toBe("rejected");
	});

	it("expired items persist in queue with expired status", () => {
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		agePendingApproval(2000);

		queue.expireStale(1000);
		expect(queue.get(item.id)!.status).toBe("expired");
	});

	it("expired items are excluded from pending list", () => {
		queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		agePendingApproval(2000);

		queue.expireStale(1000);
		expect(queue.list("pending")).toHaveLength(0);
		expect(queue.list("expired")).toHaveLength(1);
	});

	it("expires item using per-item timeoutMs when no defaultTtlMs provided", () => {
		queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 1000);
		agePendingApproval(2000);

		const { expired } = queue.expireStale();
		expect(expired).toHaveLength(1);
		expect(expired[0].status).toBe("expired");
	});

	it("per-item timeoutMs takes precedence over defaultTtlMs", () => {
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 500);
		agePendingApproval(2000);

		const { expired } = queue.expireStale(600_000);
		expect(expired).toHaveLength(1);
		expect(queue.get(item.id)!.timeoutMs).toBe(500);
	});

	it("uses evidence-policy pending retention when defaultTtlMs is undefined", () => {
		queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		agePendingApproval(25 * 60 * 60 * 1000);
		const { expired } = queue.expireStale();
		expect(expired).toHaveLength(1);
		expect(expired[0].status).toBe("expired");
	});

	it("expires a configured stale item before returning an execution snapshot", () => {
		queue = new ApprovalQueue(dir, null, { defaultTtlMs: 1000 });
		const item = queue.enqueue(
			"shell",
			{ command: "deploy" },
			"dangerous",
			"production deployment",
		);
		agePendingApproval(2000);

		expect(queue.getExecutionSnapshot(item.id)).toEqual({
			ok: false,
			reason: "not_found",
		});
		expect(queue.get(item.id)).toMatchObject({
			status: "expired",
			rejectionReason: "expired",
			resolutionSource: "timeout",
		});
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
		queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 1000);
		agePendingApproval(2000);
		const { expired } = queue.expireStale();
		expect(expired[0].status).toBe("expired");
		expect(expired[0].rejectionReason).toBe("expired");
		expect(expired[0].resolutionSource).toBe("timeout");
	});

	it("auto-approve: approved status when defaultResolution is approve", () => {
		queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 1000, "approve");
		agePendingApproval(2000);
		const { expired } = queue.expireStale();
		expect(expired[0].status).toBe("approved");
		expect(expired[0].rejectionReason).toBeUndefined();
		expect(expired[0].resolutionSource).toBe("timeout");
	});

	it("refuses to sign an auto-approval from forged pending timeout fields", () => {
		const item = queue.enqueueWorkflowGate({
			workflowName: "deploy",
			runId: "run-1",
			stepId: "confirm",
			reason: "approve deployment",
		});
		const recordPath = join(dir, `${item.id}.json`);
		const stored = JSON.parse(readFileSync(recordPath, "utf8"));
		writeFileSync(recordPath, JSON.stringify({
			...stored,
			createdAt: new Date(Date.now() - 60_000).toISOString(),
			timeoutMs: 1,
			defaultResolution: "approve",
		}, null, 2));

		expect(queue.expireStale()).toMatchObject({
			expired: [],
			blocked: [{
				approvalId: item.id,
				reason: "pending_integrity_unavailable",
			}],
		});
		expect(JSON.parse(readFileSync(recordPath, "utf8"))).toMatchObject({
			status: "pending",
			defaultResolution: "approve",
		});
		expect(JSON.parse(readFileSync(recordPath, "utf8")))
			.not.toHaveProperty("resolutionIntegrity");
	});

	it("fails closed instead of auto-approving pending policy from a prior daemon", () => {
		queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 1, "approve");
		agePendingApproval(10);
		const restarted = new ApprovalQueue(dir);

		expect(restarted.expireStale()).toMatchObject({
			expired: [],
			blocked: [{
				reason: "pending_integrity_unavailable",
			}],
		});
		expect(restarted.list("approved")).toHaveLength(0);
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
