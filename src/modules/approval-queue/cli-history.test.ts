import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ARABIC_LETTER_MARK,
	approvePendingForTest,
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
	testDir,
	testQueue,
	UNICODE_BIDI_CONTROL_PATTERN,
} from "./cli-test-support.integration.js";

describe("approval CLI history", () => {
	beforeEach(setupApprovalCliTest);
	afterEach(teardownApprovalCliTest);

	it("prints empty history and excludes pending approvals", async () => {
		expect(await captureOutput(() => run(makeProgram(), "approval", "history")))
			.toContain("No resolved approvals");
		testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		expect(await captureOutput(() => run(makeProgram(), "approval", "history")))
			.toContain("No resolved approvals");
	});

	it("lists and filters approved and rejected items", async () => {
		const approved = testQueue.enqueue("shell", { command: "ls" }, "moderate", "reason");
		approvePendingForTest(approved.id);
		const rejected = testQueue.enqueue("git", { command: "push" }, "dangerous", "reason");
		testQueue.reject(rejected.id, "too risky");
		const all = await captureOutput(() => run(makeProgram(), "approval", "history"));
		expect(all).toContain("2 resolved approval(s)");
		expect(all).toContain("status=approved");
		expect(all).toContain("status=rejected");
		expect(all).toContain("too risky");
		const filtered = await captureOutput(() =>
			run(makeProgram(), "approval", "history", "--status", "approved"),
		);
		expect(filtered).toContain("shell");
		expect(filtered).not.toContain("git");
	});

	it("strips terminal and bidi controls from resolved queue text", async () => {
		const approved = testQueue.enqueue(
			`shell${RIGHT_TO_LEFT_OVERRIDE}`,
			{ command: "ls" },
			"moderate",
			"reason",
			`${OSC_TITLE}${LEFT_TO_RIGHT_ISOLATE}approved-source${POP_DIRECTIONAL_ISOLATE}`,
		);
		approvePendingForTest(approved.id, `operator ${CSI_RED}${RIGHT_TO_LEFT_MARK}note${CSI_RESET}`);
		const rejected = testQueue.enqueue(
			`git${LEFT_TO_RIGHT_OVERRIDE}`,
			{ command: "push" },
			"dangerous",
			"reason",
			`${C1_OSC_TITLE}${ARABIC_LETTER_MARK}rejected-source`,
		);
		testQueue.reject(rejected.id, `reject ${C1_CSI_GREEN}${RIGHT_TO_LEFT_OVERRIDE}reason${CSI_RESET}`);
		const output = await captureNoColorOutput(() => run(makeProgram(), "approval", "history"));
		expect(output).toContain("operator note");
		expect(output).toContain("reject reason");
		expect(output).toContain("approved-source");
		expect(output).toContain("rejected-source");
		expect(output).not.toMatch(RAW_TERMINAL_CONTROL_PATTERN);
		expect(output).not.toMatch(UNICODE_BIDI_CONTROL_PATTERN);
	});

	it("limits results", async () => {
		for (let index = 0; index < 5; index += 1) {
			const item = testQueue.enqueue("shell", { command: `cmd${index}` }, "moderate", "reason");
			approvePendingForTest(item.id);
		}
		expect(await captureOutput(() => run(makeProgram(), "approval", "history", "-n", "2")))
			.toContain("2 resolved approval(s)");
	});

	it("rejects an invalid status", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
		const error = await captureStderr(() =>
			run(makeProgram(), "approval", "history", "--status", "bogus"),
		);
		expect(error).toContain("invalid --status");
		exitSpy.mockRestore();
	});

	it("filters by duration", async () => {
		const old = testQueue.enqueue("git", { command: "push" }, "dangerous", "reason");
		testQueue.reject(old.id);
		const oldItem = JSON.parse(
			readFileSync(join(testDir, `${old.id}.json`), "utf8"),
		);
		oldItem.resolvedAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
		writeFileSync(join(testDir, `${old.id}.json`), JSON.stringify(oldItem, null, 2));
		const recent = testQueue.enqueue("shell", { command: "ls" }, "moderate", "reason");
		approvePendingForTest(recent.id);
		const output = await captureOutput(() =>
			run(makeProgram(), "approval", "history", "--since", "1h"),
		);
		expect(output).toContain("shell");
		expect(output).not.toContain("git");
	});
});
