import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { registration } from "./approval.js";

let testQueue: ApprovalQueue;

const { runner } = registration;

function runApprovalTool(input: Record<string, unknown>) {
	return runner(input, { approvalQueue: testQueue });
}

describe("approval tool", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "approval-tool-test-"));
		testQueue = new ApprovalQueue(dir);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("has correct registration metadata", () => {
		expect(registration.tool.name).toBe("approval");
		expect(registration.effect.kind).toBe("read");
		expect(registration.effect.scope).toBe("daemon-state");
		expect(registration.group).toBe("management");
	});

	it("exposes only read-only actions in the agent-visible schema", () => {
		const action = registration.tool.input_schema.properties?.action;
		expect(action).toMatchObject({ enum: ["list", "count"] });
		expect(registration.tool.input_schema.properties).not.toHaveProperty("id");
		expect(registration.tool.input_schema.properties).not.toHaveProperty("reason");
	});

	describe("count action", () => {
		it("returns 0 for empty queue", async () => {
			const result = await runApprovalTool({ action: "count" });
			expect(result.content).toBe("0 pending approval(s)");
		});

		it("returns count of pending items", async () => {
			testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			testQueue.enqueue("git", { command: "push" }, "dangerous", "reason");
			const result = await runApprovalTool({ action: "count" });
			expect(result.content).toBe("2 pending approval(s)");
		});
	});

	describe("list action", () => {
		it("returns message when no pending items", async () => {
			const result = await runApprovalTool({ action: "list" });
			expect(result.content).toBe("No pending approvals.");
		});

		it("lists pending items with details", async () => {
			testQueue.enqueue("shell", { command: "rm -rf /tmp" }, "dangerous", "destructive command");
			const result = await runApprovalTool({ action: "list" });
			expect(result.content).toContain("1 pending");
			expect(result.content).toContain("shell");
			expect(result.content).toContain("dangerous");
			expect(result.content).toContain("destructive command");
		});
	});

	describe("mutation actions", () => {
		it("does not approve or execute queued items from the agent-visible tool", async () => {
			const item = testQueue.enqueue("todo", { action: "list" }, "dangerous", "test reason");
			const result = await runApprovalTool({ action: "approve", id: item.id });

			expect(result.is_error).toBe(true);
			expect(result.content).toContain("Unknown action");
			expect(testQueue.get(item.id)?.status).toBe("pending");
		});

		it("does not reject queued items from the agent-visible tool", async () => {
			const item = testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			const result = await runApprovalTool({ action: "reject", id: item.id, reason: "too risky" });

			expect(result.is_error).toBe(true);
			expect(result.content).toContain("Unknown action");
			expect(testQueue.get(item.id)?.status).toBe("pending");
		});
	});

	describe("unknown action", () => {
		it("returns error for invalid action", async () => {
			const result = await runApprovalTool({ action: "invalid" });
			expect(result.is_error).toBe(true);
			expect(result.content).toContain("Unknown action");
		});
	});
});
