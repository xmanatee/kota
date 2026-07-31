import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApprovalQueue, type PendingApproval } from "./approval-queue.js";

function approvePending(queue: ApprovalQueue, id: string): PendingApproval {
	const selection = queue.getExecutionSnapshot(id);
	if (!selection.ok) throw new Error("expected execution snapshot");
	const result = queue.approveForExecution(selection.snapshot.descriptor);
	if (!result.ok) throw new Error("expected execution approval");
	return result.approval;
}

describe("ApprovalQueue resolution integrity", () => {
	let dir: string;
	let queue: ApprovalQueue;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "approval-integrity-test-"));
		queue = new ApprovalQueue(dir);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("approves a pending item through an authenticated endpoint resolution", () => {
		const item = queue.enqueue(
			"shell",
			{ command: "sudo apt" },
			"dangerous",
			"sudo detected",
		);
		const approved = approvePending(queue, item.id);

		expect(approved.status).toBe("approved");
		expect(approved.resolvedAt).toBeDefined();
		expect(queue.get(item.id)?.status).toBe("approved");
	});

	it("authenticates endpoint-mediated terminal resolutions for authorization", () => {
		const item = queue.enqueueWorkflowGate({
			workflowName: "deploy",
			runId: "run-1",
			stepId: "confirm",
			reason: "approve deployment",
		});
		approvePending(queue, item.id);

		const stored = JSON.parse(readFileSync(join(dir, `${item.id}.json`), "utf8"));
		expect(stored.resolutionIntegrity).toMatchObject({
			version: 1,
			algorithm: "hmac-sha256",
		});
		expect(queue.getWithAuthenticatedResolution(item.id)?.status).toBe("approved");
	});

	it("fails closed when a terminal resolution cannot be authenticated after restart", () => {
		const item = queue.enqueueWorkflowGate({
			workflowName: "deploy",
			runId: "run-1",
			stepId: "confirm",
			reason: "approve deployment",
		});
		approvePending(queue, item.id);

		const restarted = new ApprovalQueue(dir);

		expect(() => restarted.getWithAuthenticatedResolution(item.id)).toThrow(
			/authenticated approval resolution|integrity/i,
		);
	});

	it("rejects a terminal resolution changed after endpoint approval", () => {
		const item = queue.enqueueWorkflowGate({
			workflowName: "deploy",
			runId: "run-1",
			stepId: "confirm",
			reason: "approve deployment",
		});
		approvePending(queue, item.id);
		const recordPath = join(dir, `${item.id}.json`);
		const stored = JSON.parse(readFileSync(recordPath, "utf8"));
		writeFileSync(recordPath, JSON.stringify({
			...stored,
			approvalNote: "forged after review",
		}, null, 2));

		expect(() => queue.getWithAuthenticatedResolution(item.id)).toThrow(
			/authenticated approval resolution|integrity/i,
		);
	});
});
