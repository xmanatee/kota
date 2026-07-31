import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const confirmationMocks = vi.hoisted(() => ({
	promptConfirm: vi.fn<(message: string) => Promise<boolean>>(),
}));

vi.mock("./cli-support.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./cli-support.js")>();
	return { ...actual, promptConfirm: confirmationMocks.promptConfirm };
});

import {
	approvePendingForTest,
	captureOutput,
	captureStderr,
	executeTool,
	makeProgram,
	run,
	setupApprovalCliTest,
	teardownApprovalCliTest,
	testApprovalsClient,
	testQueue,
	withRedactedAccessToken,
	writeApprovalReviewTranscript,
} from "./cli-test-support.integration.js";
import type { ApprovalsClient } from "./client.js";

function answerConfirmation(answer: "y" | "n"): void {
	confirmationMocks.promptConfirm.mockImplementation(async (message) => {
		process.stdout.write(`${message}${answer}\n`);
		return answer === "y";
	});
}

describe("approval CLI approve", () => {
	beforeEach(() => {
		setupApprovalCliTest();
		answerConfirmation("y");
	});
	afterEach(teardownApprovalCliTest);

	it("shows the exact credential-safe operation and waits for confirmation before executing", async () => {
		const item = testQueue.enqueue(
			"shell",
			{
				command: "git push origin main",
				cwd: "/srv/repo",
				args: ["--force-with-lease"],
				accessToken: "raw-token",
			},
			"dangerous",
			"test reason",
			undefined,
			undefined,
			undefined,
			"user: push the reviewed branch for owner@example.test; token=raw-context-token",
		);
		vi.mocked(executeTool).mockResolvedValue({ content: "file1.ts\nfile2.ts" });
		const output = await captureOutput(() => run(makeProgram(), "approval", "approve", item.id));
		writeApprovalReviewTranscript(item.id, output);
		expect(output).toContain("Reviewing exact operation");
		expect(output).toContain('"command":"git push origin main"');
		expect(output).toContain('"cwd":"/srv/repo"');
		expect(output).toContain('"args":["--force-with-lease"]');
		expect(output).toContain('"accessToken":"[redacted]"');
		expect(output).toContain(
			"Context: user: push the reviewed branch for owner@example.test; token=[redacted]",
		);
		expect(output).toMatch(/[a-f0-9]{64}/);
		expect(output).not.toContain("raw-token");
		expect(output).not.toContain("raw-context-token");
		expect(confirmationMocks.promptConfirm).toHaveBeenCalledWith(
			"Approve and execute this exact operation? [y/N] ",
		);
		expect(output.indexOf("Digest:")).toBeLessThan(output.indexOf("Approve and execute this exact operation?"));
		expect(output.indexOf("Approve and execute this exact operation?")).toBeLessThan(
			output.indexOf("Approved and executed shell"),
		);
		expect(output).toContain("Approved and executed shell");
		expect(vi.mocked(executeTool)).toHaveBeenCalledWith("shell", {
			command: "git push origin main",
			cwd: "/srv/repo",
			args: ["--force-with-lease"],
			accessToken: "raw-token",
		});
	});

	it("keeps the approval pending when the operator declines after review", async () => {
		answerConfirmation("n");
		const item = testQueue.enqueue(
			"shell",
			{ command: "deploy --path /srv/production" },
			"dangerous",
			"production deploy",
		);
		const client = testApprovalsClient();
		const approve = vi.spyOn(client, "approve");

		const output = await captureOutput(() => run(makeProgram(client), "approval", "approve", item.id));

		expect(output).toContain('"command":"deploy --path /srv/production"');
		expect(output).toContain("Approve and execute this exact operation? [y/N] n");
		expect(output).toContain("Aborted.");
		expect(approve).not.toHaveBeenCalled();
		expect(testQueue.get(item.id)?.status).toBe("pending");
		expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
	});

	it("does not re-execute approvals the daemon already executed", async () => {
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
		const output = await captureOutput(() => run(makeProgram(client), "approval", "approve", item.id));
		expect(output).toContain(`Approved and executed shell [${item.id}]`);
		expect(output).toContain("output redacted by daemon policy");
		expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
	});

	it("resolves workflow gates without trying to execute their queue label as a tool", async () => {
		const item = testQueue.enqueueWorkflowGate({
			workflowName: "test-wf",
			runId: "run-1",
			stepId: "gate",
			reason: "continue the workflow",
		});

		const output = await captureOutput(() => run(makeProgram(), "approval", "approve", item.id));

		expect(output).toContain(`Approved workflow gate workflow-approval/test-wf/gate [${item.id}]`);
		expect(confirmationMocks.promptConfirm).toHaveBeenCalledWith(
			"Approve this exact workflow gate? [y/N] ",
		);
		expect(testQueue.get(item.id)?.status).toBe("approved");
		expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
	});

	it.each([
		["deadbeef", "not found"],
		["../abcd1234", "invalid approval id"],
	])("rejects invalid target %s", async (id, message) => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
		const error = await captureStderr(() => run(makeProgram(), "approval", "approve", id));
		expect(error).toContain(message);
		exitSpy.mockRestore();
	});
});
