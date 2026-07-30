import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type PendingApproval, projectApprovalForClient } from "#core/daemon/approval-queue.js";
import {
	ARABIC_LETTER_MARK,
	C1_CSI_GREEN,
	C1_OSC_TITLE,
	CSI_RED,
	CSI_RESET,
	captureNoColorOutput,
	captureOutput,
	captureStderr,
	LEFT_TO_RIGHT_ISOLATE,
	LEFT_TO_RIGHT_OVERRIDE,
	makeProgram,
	OSC_TITLE,
	POP_DIRECTIONAL_ISOLATE,
	RAW_TERMINAL_CONTROL_PATTERN,
	RIGHT_TO_LEFT_MARK,
	RIGHT_TO_LEFT_OVERRIDE,
	run,
	setupApprovalCliTest,
	teardownApprovalCliTest,
	testApprovalsClient,
	testQueue,
	UNICODE_BIDI_CONTROL_PATTERN,
} from "./cli-test-support.integration.js";
import type { ApprovalsClient } from "./client.js";

describe("approval CLI list and direct rejection", () => {
	beforeEach(setupApprovalCliTest);
	afterEach(teardownApprovalCliTest);

	it("prints an empty list and accurate counts", async () => {
		expect(await captureOutput(() => run(makeProgram(), "approval", "list")))
			.toContain("No pending approvals");
		expect(await captureOutput(() => run(makeProgram(), "approval", "count"))).toContain("0");
		testQueue.enqueue("shell", { command: "a" }, "dangerous", "r");
		testQueue.enqueue("git", { command: "b" }, "dangerous", "r");
		expect(await captureOutput(() => run(makeProgram(), "approval", "count"))).toContain("2");
	});

	it("lists the safe review descriptor without exposing credentials", async () => {
		testQueue.enqueue("shell", { command: "rm -rf /tmp", accessToken: "raw-token" }, "dangerous", "destructive op");
		const output = await captureOutput(() => run(makeProgram(), "approval", "list"));
		expect(output).toContain("shell");
		expect(output).toContain("dangerous");
		expect(output).toContain("destructive op");
		expect(output).toContain('"command":"rm -rf /tmp"');
		expect(output).toContain('"accessToken":"[redacted]"');
		expect(output).toMatch(/[a-f0-9]{64}/);
		expect(output).not.toContain("raw-token");
	});

	it("strips terminal controls from pending queue text", async () => {
		testQueue.enqueue(
			`shell${CSI_RED}`,
			{ command: "printf pwned" },
			"dangerous",
			`needs review ${CSI_RED}red${CSI_RESET} ${C1_CSI_GREEN}green`,
			`${OSC_TITLE}queued-source`,
			undefined,
			undefined,
			`assistant: earlier line\nuser: ${C1_OSC_TITLE}why ${CSI_RED}now${CSI_RESET}`,
		);
		const output = await captureNoColorOutput(() => run(makeProgram(), "approval", "list"));
		expect(output).toContain("needs review red green");
		expect(output).toContain("queued-source");
		expect(output).toContain("Context: assistant: earlier line user: why now");
		expect(output).not.toMatch(RAW_TERMINAL_CONTROL_PATTERN);
	});

	it("strips Unicode bidi controls from pending queue text", async () => {
		const item: PendingApproval = {
			id: "1234abcd",
			scopeId: "scope-test",
			tool: `shell${RIGHT_TO_LEFT_OVERRIDE}`,
			input: {
				command: `safe${RIGHT_TO_LEFT_OVERRIDE} --approve all`,
				label: `${LEFT_TO_RIGHT_ISOLATE}visible${POP_DIRECTIONAL_ISOLATE}`,
			},
			risk: "dangerous",
			reason: `needs review ${RIGHT_TO_LEFT_MARK}spoof`,
			source: `${ARABIC_LETTER_MARK}queued-source`,
			context: `assistant: earlier line\nuser: ${LEFT_TO_RIGHT_OVERRIDE}why now`,
			createdAt: new Date().toISOString(),
			status: "pending",
		};
		const client: ApprovalsClient = {
			...testApprovalsClient(),
			async list() {
				return { approvals: [projectApprovalForClient(item, "daemon-api", item.input)] };
			},
		};
		const output = await captureNoColorOutput(() => run(makeProgram(client), "approval", "list"));
		expect(output).toContain("safe --approve all");
		expect(output).toContain("visible");
		expect(output).toContain("Context: assistant: earlier line user: why now");
		expect(output).not.toMatch(UNICODE_BIDI_CONTROL_PATTERN);
	});

	it("rejects a pending item with an optional reason", async () => {
		const item = testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		const output = await captureOutput(() =>
			run(makeProgram(), "approval", "reject", item.id, "--reason", "too risky"),
		);
		expect(output).toContain("Rejected");
		expect(output).toContain("too risky");
	});

	it.each([
		["deadbeef", "not found"],
		["../abcd1234", "invalid approval id"],
	])("rejects invalid target %s", async (id, message) => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
		const error = await captureStderr(() => run(makeProgram(), "approval", "reject", id));
		expect(error).toContain(message);
		exitSpy.mockRestore();
	});
});
