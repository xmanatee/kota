import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue, resetApprovalQueue } from "../modules/approval-queue/queue.js";
import { registration } from "./approval.js";

vi.mock("../event-bus.js", () => ({
	tryEmit: vi.fn(),
	getEventBus: () => null,
}));

// Mock getApprovalQueue to return our test queue
let testQueue: ApprovalQueue;
vi.mock("../modules/approval-queue/queue.js", async (importOriginal) => {
	const mod = await importOriginal<typeof import("../modules/approval-queue/queue.js")>();
	return {
		...mod,
		getApprovalQueue: () => testQueue,
	};
});

const { runner } = registration;

describe("approval tool", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "approval-tool-test-"));
		testQueue = new ApprovalQueue(dir);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
		resetApprovalQueue();
	});

	it("has correct registration metadata", () => {
		expect(registration.tool.name).toBe("approval");
		expect(registration.risk).toBe("safe");
		expect(registration.group).toBe("management");
	});

	describe("count action", () => {
		it("returns 0 for empty queue", async () => {
			const result = await runner({ action: "count" });
			expect(result.content).toBe("0 pending approval(s)");
		});

		it("returns count of pending items", async () => {
			testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			testQueue.enqueue("git", { command: "push" }, "dangerous", "reason");
			const result = await runner({ action: "count" });
			expect(result.content).toBe("2 pending approval(s)");
		});
	});

	describe("list action", () => {
		it("returns message when no pending items", async () => {
			const result = await runner({ action: "list" });
			expect(result.content).toBe("No pending approvals.");
		});

		it("lists pending items with details", async () => {
			testQueue.enqueue("shell", { command: "rm -rf /tmp" }, "dangerous", "destructive command");
			const result = await runner({ action: "list" });
			expect(result.content).toContain("1 pending");
			expect(result.content).toContain("shell");
			expect(result.content).toContain("dangerous");
			expect(result.content).toContain("destructive command");
		});
	});

	describe("approve action", () => {
		it("requires id", async () => {
			const result = await runner({ action: "approve" });
			expect(result.is_error).toBe(true);
			expect(result.content).toContain("id is required");
		});

		it("returns error for nonexistent id", async () => {
			const result = await runner({ action: "approve", id: "nonexistent" });
			expect(result.is_error).toBe(true);
			expect(result.content).toContain("not found");
		});

		it("approves and executes a pending item", async () => {
			// Use "todo" (core tool) instead of "glob" (filesystem module)
			const item = testQueue.enqueue("todo", { action: "list" }, "dangerous", "test reason");
			const result = await runner({ action: "approve", id: item.id });
			expect(result.content).toContain("Approved and executed todo");
			// todo returns task list — just verify it ran without crashing
			expect(result.is_error).toBeUndefined();
		});

		it("cannot approve already resolved item", async () => {
			const item = testQueue.enqueue("shell", { command: "ls" }, "dangerous", "reason");
			testQueue.reject(item.id);
			const result = await runner({ action: "approve", id: item.id });
			expect(result.is_error).toBe(true);
			expect(result.content).toContain("already resolved");
		});
	});

	describe("reject action", () => {
		it("requires id", async () => {
			const result = await runner({ action: "reject" });
			expect(result.is_error).toBe(true);
			expect(result.content).toContain("id is required");
		});

		it("rejects a pending item", async () => {
			const item = testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			const result = await runner({ action: "reject", id: item.id });
			expect(result.content).toContain("Rejected: shell");
		});

		it("rejects with reason", async () => {
			const item = testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			const result = await runner({ action: "reject", id: item.id, reason: "too risky" });
			expect(result.content).toContain("too risky");
		});
	});

	describe("unknown action", () => {
		it("returns error for invalid action", async () => {
			const result = await runner({ action: "invalid" });
			expect(result.is_error).toBe(true);
			expect(result.content).toContain("Unknown action");
		});
	});
});
