import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	ApprovalQueue,
	isApprovalId,
	type PendingApproval,
	projectApprovalForClient,
} from "./approval-queue.js";

function approvePending(
	queue: ApprovalQueue,
	id: string,
	note?: string,
	resolutionSource?: string,
): PendingApproval | null {
	const selection = queue.getExecutionSnapshot(id);
	if (!selection.ok) return null;
	const result = queue.approveForExecution(
		selection.snapshot.descriptor,
		note,
		resolutionSource,
	);
	return result.ok ? result.approval : null;
}

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
		expect(item.kind).toBe("tool_call");
		expect(item.tool).toBe("shell");
		expect(item.status).toBe("pending");
		expect(item.risk).toBe("dangerous");

		const retrieved = queue.get(item.id);
		expect(retrieved).toEqual(item);
	});

	it("stores workflow gates as a distinct non-executable approval kind", () => {
		const item = queue.enqueueWorkflowGate({
			workflowName: "deploy",
			runId: "run-1",
			stepId: "confirm",
			reason: "approve deployment",
		});

		expect(item).toMatchObject({
			kind: "workflow_gate",
			tool: "workflow-approval/deploy/confirm",
			input: {
				workflowName: "deploy",
				runId: "run-1",
				stepId: "confirm",
			},
		});
		expect(item.input).not.toHaveProperty("reason");
		expect(queue.get(item.id)).toEqual(item);

		const restarted = new ApprovalQueue(dir);
		const selection = restarted.getExecutionSnapshot(item.id);
		expect(selection).toMatchObject({
			ok: false,
			reason: "input_unavailable",
			approval: { id: item.id, status: "pending" },
		});
	});

	it("redacts workflow-gate reasons without duplicating them into stored input", () => {
		const secretToken = "gate-secret-value";
		const ownerEmail = "owner@example.test";
		const item = queue.enqueueWorkflowGate({
			workflowName: "deploy",
			runId: "run-1",
			stepId: "confirm",
			reason: `deploy with token=${secretToken} for ${ownerEmail}`,
		});
		const storedText = readFileSync(join(dir, `${item.id}.json`), "utf8");
		const stored = JSON.parse(storedText) as PendingApproval;

		expect(stored.reason).toBe("deploy with token=[redacted] for [redacted]");
		expect(stored.input).toEqual({
			workflowName: "deploy",
			runId: "run-1",
			stepId: "confirm",
		});
		expect(storedText).not.toContain(secretToken);
		expect(storedText).not.toContain(ownerEmail);

		writeFileSync(
			join(dir, `${item.id}.json`),
			JSON.stringify({
				...stored,
				input: {
					...stored.input,
					reason: `token=${secretToken} for ${ownerEmail}`,
				},
			}),
		);
		expect(() => queue.get(item.id)).toThrow(/invalid workflow gate/);
	});

	it("rejects stored approval records without a validated kind", () => {
		writeFileSync(join(dir, "deadbeef.json"), JSON.stringify({
			id: "deadbeef",
			scopeId: queue.getScopeId(),
			tool: "shell",
			input: { redacted: true, reason: "tool-io" },
			risk: "moderate",
			reason: "invalid record",
			createdAt: new Date().toISOString(),
			status: "pending",
		}));

		expect(() => queue.get("deadbeef")).toThrow(/invalid approval kind/);
	});

	it("rejects a stored workflow gate reclassified as an executable tool call", () => {
		const item = queue.enqueueWorkflowGate({
			workflowName: "deploy",
			runId: "run-1",
			stepId: "confirm",
			reason: "approve deployment",
		});
		const path = join(dir, `${item.id}.json`);
		const stored = JSON.parse(readFileSync(path, "utf8")) as PendingApproval;

		writeFileSync(path, JSON.stringify({ ...stored, kind: "tool_call" }));

		expect(() => queue.get(item.id)).toThrow(/invalid tool-call approval identity/);
	});

	it("reserves workflow-gate source and tool identities for workflow gates", () => {
		expect(() => queue.enqueue(
			"shell",
			{ command: "deploy" },
			"moderate",
			"invalid source",
			"workflow-step",
		)).toThrow(/must be enqueued with enqueueWorkflowGate/);
		expect(() => queue.enqueue(
			"workflow-approval/deploy/confirm",
			{ command: "deploy" },
			"moderate",
			"invalid tool identity",
		)).toThrow(/must be enqueued with enqueueWorkflowGate/);
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
			expect(approvePending(queue, `../${siblingId}`)).toBeNull();
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
		approvePending(queue, item.id);
		queue.enqueue("git", { command: "push" }, "dangerous", "reason2");

		const all = queue.list();
		expect(all).toHaveLength(2);
		const pending = queue.list("pending");
		expect(pending).toHaveLength(1);
		expect(pending[0].tool).toBe("git");
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
		approvePending(queue, item.id);
		expect(approvePending(queue, item.id)).toBeNull();
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
		approvePending(queue, third.id);

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

	it("stores projected input and context in durable records", () => {
		const ctx = "User: deploy with secret=raw-token\nAssistant: I will run it";
		const item = queue.enqueue(
			"shell",
			{ command: "deploy", accessToken: "raw-token" },
			"dangerous",
			"reason",
			undefined,
			undefined,
			undefined,
			ctx,
		);
		const stored = JSON.parse(readFileSync(join(dir, `${item.id}.json`), "utf-8")) as {
			input: { redacted: true; reason: string };
			context?: string;
			contextRedaction?: { redacted: true; reason: string; bytes: number };
		};
		expect(stored.input).toMatchObject({ redacted: true, reason: "tool-io" });
		expect(stored.context).toBeUndefined();
		expect(stored.contextRedaction).toMatchObject({ redacted: true, reason: "tool-io" });
		expect(JSON.stringify(stored)).not.toContain("raw-token");
		expect(JSON.stringify(queue.get(item.id))).not.toContain("raw-token");
	});

	it("redacts sensitive non-input approval text in storage and client projections", () => {
		const item = queue.enqueue(
			"shell",
			{ command: "deploy" },
			"dangerous",
			"reason token=reason-token for owner@example.test",
			"source apiKey=source-key",
		);
		const approved = approvePending(
			queue,
			item.id,
			"approved because secret=note-token for approver@example.test",
			"resolution token=resolution-token",
		);
		expect(approved).not.toBeNull();
		expect(approved!.reason).toBe("reason token=[redacted] for [redacted]");
		expect(approved!.source).toBe("source apiKey=[redacted]");
		expect(approved!.approvalNote).toBe("approved because secret=[redacted] for [redacted]");
		expect(approved!.resolutionSource).toBe("resolution token=[redacted]");

		const stored = readFileSync(join(dir, `${item.id}.json`), "utf-8");
		expect(stored).not.toContain("reason-token");
		expect(stored).not.toContain("owner@example.test");
		expect(stored).not.toContain("source-key");
		expect(stored).not.toContain("note-token");
		expect(stored).not.toContain("resolution-token");
		expect(JSON.stringify(projectApprovalForClient(approved!))).not.toContain("reason-token");
	});

	it("redacts sensitive rejection text in storage and returned records", () => {
		const item = queue.enqueue(
			"shell",
			{ command: "deploy" },
			"dangerous",
			"reason token=reason-token",
			"source secret=source-token",
		);
		const rejected = queue.reject(
			item.id,
			"reject because token=reject-token for owner@example.test",
			"operator secret=resolution-token",
		);
		expect(rejected).not.toBeNull();
		expect(rejected!.reason).toBe("reason token=[redacted]");
		expect(rejected!.source).toBe("source secret=[redacted]");
		expect(rejected!.rejectionReason).toBe("reject because token=[redacted] for [redacted]");
		expect(rejected!.resolutionSource).toBe("operator secret=[redacted]");

		const stored = readFileSync(join(dir, `${item.id}.json`), "utf-8");
		expect(stored).not.toContain("reject-token");
		expect(stored).not.toContain("resolution-token");
		expect(stored).not.toContain("owner@example.test");
	});

	it("approves with live execution input without persisting it", () => {
		const item = queue.enqueue(
			"shell",
			{ command: "deploy", accessToken: "raw-token" },
			"dangerous",
			"reason",
		);
		const approved = approvePending(queue, item.id);
		expect(approved?.input).toEqual({ command: "deploy", accessToken: "raw-token" });
		const stored = JSON.parse(readFileSync(join(dir, `${item.id}.json`), "utf-8")) as {
			input: { redacted: true; reason: string };
			status: string;
		};
		expect(stored.status).toBe("approved");
		expect(stored.input).toMatchObject({ redacted: true, reason: "tool-io" });
		expect(JSON.stringify(stored)).not.toContain("raw-token");
	});

	it("uses injected clock port for deterministic timestamps and expiration", () => {
		let currentTime = new Date("2026-08-01T12:00:00.000Z");
		const customClock = { now: () => currentTime };
		const customDir = mkdtempSync(join(tmpdir(), "approval-clock-test-"));
		try {
			const clockQueue = new ApprovalQueue(customDir, null, { clock: customClock, defaultTtlMs: 10_000 });
			expect(clockQueue.getClock()).toBe(customClock);

			const item = clockQueue.enqueue("shell", { command: "uptime" }, "safe", "check uptime");
			expect(item.createdAt).toBe("2026-08-01T12:00:00.000Z");

			// Advance clock past TTL
			currentTime = new Date("2026-08-01T12:00:15.000Z");
			const sweep = clockQueue.expireStale();
			expect(sweep.expired).toHaveLength(1);
			expect(sweep.expired[0].id).toBe(item.id);
			expect(sweep.expired[0].status).toBe("expired");
			expect(sweep.expired[0].resolvedAt).toBe("2026-08-01T12:00:15.000Z");
		} finally {
			rmSync(customDir, { recursive: true, force: true });
		}
	});

	it("supports single-item verified expiration through expire()", () => {
		const item = queue.enqueue("shell", { command: "test" }, "moderate", "run test");
		expect(item.status).toBe("pending");

		const expired = queue.expire(item.id, "operator-timeout");
		expect(expired).not.toBeNull();
		expect(expired!.status).toBe("expired");
		expect(expired!.rejectionReason).toBe("expired");
		expect(expired!.resolutionSource).toBe("operator-timeout");
		expect(queue.get(item.id)!.status).toBe("expired");

		// Cannot re-expire or reject an already expired item
		expect(queue.expire(item.id)).toBeNull();
		expect(queue.reject(item.id)).toBeNull();
	});

	it("exposes public persistence port and accessors", () => {
		expect(queue.getPersistence()).toBeDefined();
		expect(queue.getClock()).toBeDefined();
		expect(queue.getScopeId()).toBeDefined();
	});
});
