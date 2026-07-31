import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	approvePendingForTest,
	captureOutput,
	executeTool,
	makeProgram,
	run,
	setupApprovalCliTest,
	teardownApprovalCliTest,
	testApprovalsClient,
	testQueue,
	withRedactedAccessToken,
} from "./cli-test-support.integration.js";
import type { ApprovalsClient } from "./client.js";

describe("approval CLI bulk mutations", () => {
	beforeEach(setupApprovalCliTest);
	afterEach(teardownApprovalCliTest);

	it("prints empty messages when no approvals are pending", async () => {
		expect(await captureOutput(() => run(makeProgram(), "approval", "approve-all", "--yes")))
			.toContain("No pending approvals");
		expect(await captureOutput(() => run(makeProgram(), "approval", "reject-all", "--yes")))
			.toContain("No pending approvals");
	});

	it("approves every pending item", async () => {
		const first = testQueue.enqueue("glob", { pattern: "*.ts" }, "safe", "reason a");
		const second = testQueue.enqueue("shell", { command: "ls" }, "moderate", "reason b");
		vi.mocked(executeTool).mockResolvedValue({ content: "ok" });
		const output = await captureOutput(() => run(makeProgram(), "approval", "approve-all", "--yes"));
		expect(output).toContain(`Approved and executed glob [${first.id}]`);
		expect(output).toContain(`Approved and executed shell [${second.id}]`);
		expect(output).toContain("Done: 2 approved, 0 failed");
		expect(vi.mocked(executeTool)).toHaveBeenCalledTimes(2);
	});

	it("uses daemon execution results for redacted approved items", async () => {
		const item = testQueue.enqueue("shell", { command: "deploy", accessToken: "raw-token" }, "moderate", "reason");
		const baseClient = testApprovalsClient();
		const client: ApprovalsClient = {
			...baseClient,
			async approve(id, _reviewDigest, note) {
				const approved = approvePendingForTest(id, note);
				return approved ? {
					ok: true,
					approval: withRedactedAccessToken(approved),
					resolution: {
						kind: "tool_execution",
						execution: { status: "succeeded", output: { redacted: true, reason: "tool-io", bytes: 2 } },
					},
				} : { ok: false, reason: "not_found" };
			},
		};
		const output = await captureOutput(() => run(makeProgram(client), "approval", "approve-all", "--yes"));
		expect(output).toContain(`Approved and executed shell [${item.id}]`);
		expect(output).toContain("output redacted by daemon policy");
		expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
	});

	it("resolves workflow gates without executing their queue labels", async () => {
		const item = testQueue.enqueueWorkflowGate({
			workflowName: "test-wf",
			runId: "run-1",
			stepId: "gate",
			reason: "continue the workflow",
		});

		const output = await captureOutput(() => run(makeProgram(), "approval", "approve-all", "--yes"));

		expect(output).toContain(`Approved workflow gate workflow-approval/test-wf/gate [${item.id}]`);
		expect(output).toContain("Done: 1 approved, 0 failed");
		expect(testQueue.get(item.id)?.status).toBe("approved");
		expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
	});

	it("attaches notes and filters approval by risk", async () => {
		const safe = testQueue.enqueue("glob", { pattern: "*.ts" }, "safe", "reason a");
		const dangerous = testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason b");
		vi.mocked(executeTool).mockResolvedValue({ content: "ok" });
		const output = await captureOutput(() =>
			run(makeProgram(), "approval", "approve-all", "--yes", "--risk", "dangerous", "--note", "batch run"),
		);
		expect(output).toContain(`Approved and executed shell [${dangerous.id}]`);
		expect(output).toContain("note: batch run");
		expect(testQueue.get(safe.id)?.status).toBe("pending");
	});

	it("reports an empty risk selection and a raced approval", async () => {
		testQueue.enqueue("glob", { pattern: "*.ts" }, "safe", "reason");
		expect(await captureOutput(() =>
			run(makeProgram(), "approval", "approve-all", "--yes", "--risk", "dangerous"),
		)).toContain('risk level "dangerous"');
		vi.spyOn(testQueue, "approveForExecution").mockReturnValueOnce({
			ok: false,
			reason: "not_found",
		});
		expect(await captureOutput(() => run(makeProgram(), "approval", "approve-all", "--yes")))
			.toContain("no longer pending");
	});

	it("rejects every pending item with a shared reason", async () => {
		const first = testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason a");
		const second = testQueue.enqueue("git", { command: "push" }, "moderate", "reason b");
		const output = await captureOutput(() =>
			run(makeProgram(), "approval", "reject-all", "--yes", "--reason", "bad batch"),
		);
		expect(output).toContain(`Rejected shell [${first.id}]`);
		expect(output).toContain(`Rejected git [${second.id}]`);
		expect(output).toContain("Done: 2 rejected");
		expect(testQueue.get(first.id)?.rejectionReason).toBe("bad batch");
	});

	it("filters rejection by risk and handles empty or raced selections", async () => {
		const safe = testQueue.enqueue("glob", { pattern: "*.ts" }, "safe", "reason a");
		const dangerous = testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason b");
		const filtered = await captureOutput(() =>
			run(makeProgram(), "approval", "reject-all", "--yes", "--risk", "dangerous"),
		);
		expect(filtered).toContain(`Rejected shell [${dangerous.id}]`);
		expect(testQueue.get(safe.id)?.status).toBe("pending");
		expect(await captureOutput(() =>
			run(makeProgram(), "approval", "reject-all", "--yes", "--risk", "dangerous"),
		)).toContain('risk level "dangerous"');
		vi.spyOn(testQueue, "reject").mockReturnValueOnce(null);
		expect(await captureOutput(() => run(makeProgram(), "approval", "reject-all", "--yes")))
			.toContain("no longer pending");
	});
});
