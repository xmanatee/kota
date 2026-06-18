import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ApprovalQueue,
	defaultApprovalPendingTtlMs,
	type PendingApproval,
	resetApprovalQueue,
} from "#core/daemon/approval-queue.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { registerApprovalCommands } from "./cli.js";
import type { ApprovalsClient } from "./client.js";

function testApprovalsClient(): ApprovalsClient {
	return {
		async list(filter) {
			testQueue.expireStale(defaultApprovalPendingTtlMs());
			const status = filter?.status;
			if (status === undefined) return { approvals: testQueue.list("pending") };
			if (status === "all") return { approvals: testQueue.list() };
			return { approvals: testQueue.list(status) };
		},
		async approve(id, note) {
			const item = testQueue.approve(id, note);
			return item ? { ok: true, approval: item } : { ok: false, reason: "not_found" };
		},
		async reject(id, reason) {
			const item = testQueue.reject(id, reason);
			return item ? { ok: true, approval: item } : { ok: false, reason: "not_found" };
		},
	};
}

function stubCtx(approvals: ApprovalsClient = testApprovalsClient()): ModuleContext {
	return {
		client: {
			approvals,
		},
	} as unknown as ModuleContext;
}

vi.mock("#core/events/event-bus.js", () => ({
	tryEmit: vi.fn(),
	getEventBus: () => null,
}));

let testQueue: ApprovalQueue;
vi.mock("#core/daemon/approval-queue.js", async (importOriginal) => {
	const mod = await importOriginal<typeof import("#core/daemon/approval-queue.js")>();
	return {
		...mod,
		getApprovalQueue: () => testQueue,
	};
});

vi.mock("#core/tools/index.js", () => ({
	executeTool: vi.fn(),
}));

import { executeTool } from "#core/tools/index.js";

const CSI_RED = "\x1b[31m";
const CSI_RESET = "\x1b[0m";
const OSC_TITLE = "\x1b]0;approval-pwned\x07";
const C1_CSI_GREEN = "\x9b32m";
const C1_OSC_TITLE = "\x9d0;approval-c1-pwned\x07";
const ARABIC_LETTER_MARK = "\u061c";
const RIGHT_TO_LEFT_MARK = "\u200f";
const LEFT_TO_RIGHT_OVERRIDE = "\u202d";
const RIGHT_TO_LEFT_OVERRIDE = "\u202e";
const LEFT_TO_RIGHT_ISOLATE = "\u2066";
const POP_DIRECTIONAL_ISOLATE = "\u2069";
// biome-ignore lint/suspicious/noControlCharactersInRegex: regression checks assert raw terminal controls are absent
const RAW_TERMINAL_CONTROL_PATTERN = /[\x00-\x09\x0b-\x1f\x7f-\x9f]/;
const UNICODE_BIDI_CONTROL_PATTERN = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

function withRedactedAccessToken(item: PendingApproval): PendingApproval {
	return {
		...item,
		input: {
			...item.input,
			accessToken: "[redacted]",
		},
	};
}

function makeProgram(approvals?: ApprovalsClient): Command {
	const program = new Command();
	program.exitOverride(); // prevent process.exit in tests
	registerApprovalCommands(program, stubCtx(approvals));
	return program;
}

async function run(program: Command, ...args: string[]): Promise<void> {
	await program.parseAsync(["node", "cli", ...args]);
}

async function captureOutput(fn: () => Promise<void>): Promise<string> {
	const lines: string[] = [];
	const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
		lines.push(`${args.join(" ")}\n`);
	});
	const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((data) => {
		lines.push(String(data));
		return true;
	});
	try {
		await fn();
	} finally {
		logSpy.mockRestore();
		stdoutSpy.mockRestore();
	}
	return lines.join("");
}

async function captureNoColorOutput(fn: () => Promise<void>): Promise<string> {
	const previousNoColor = process.env.NO_COLOR;
	process.env.NO_COLOR = "1";
	try {
		return await captureOutput(fn);
	} finally {
		if (previousNoColor === undefined) {
			delete process.env.NO_COLOR;
		} else {
			process.env.NO_COLOR = previousNoColor;
		}
	}
}

async function captureStderr(fn: () => Promise<void>): Promise<string> {
	const lines: string[] = [];
	const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((data) => {
		lines.push(String(data));
		return true;
	});
	try {
		await fn();
	} catch {
		// Expected in tests that mock process.exit for validation failures.
	} finally {
		stderrSpy.mockRestore();
	}
	return lines.join("");
}

describe("approval CLI commands", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "approval-cli-test-"));
		testQueue = new ApprovalQueue(dir);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
		resetApprovalQueue();
		vi.clearAllMocks();
	});

	describe("approval list", () => {
		it("prints empty message when no pending items", async () => {
			const output = await captureOutput(() => run(makeProgram(), "approval", "list"));
			expect(output).toContain("No pending approvals");
		});

		it("lists pending items with id, tool, risk, and reason", async () => {
			testQueue.enqueue("shell", { command: "rm -rf /tmp" }, "dangerous", "destructive op");
			const output = await captureOutput(() => run(makeProgram(), "approval", "list"));
			expect(output).toContain("shell");
			expect(output).toContain("dangerous");
			expect(output).toContain("destructive op");
		});

		it("strips terminal controls from untrusted pending queue text", async () => {
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

			expect(output).toContain("shell");
			expect(output).toContain("needs review red green");
			expect(output).toContain("queued-source");
			expect(output).not.toContain("why now");
			expect(output).not.toMatch(RAW_TERMINAL_CONTROL_PATTERN);
			expect(output).not.toContain(CSI_RED);
			expect(output).not.toContain(OSC_TITLE);
			expect(output).not.toContain(C1_OSC_TITLE);
		});

		it("strips Unicode bidi controls from untrusted pending queue text", async () => {
			const item: PendingApproval = {
				id: "1234abcd",
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
					return { approvals: [item] };
				},
			};

			const output = await captureNoColorOutput(() => run(makeProgram(client), "approval", "list"));

			expect(output).toContain("shell");
			expect(output).toContain("safe --approve all");
			expect(output).toContain("visible");
			expect(output).toContain("needs review spoof");
			expect(output).toContain("queued-source");
			expect(output).toContain("why now");
			expect(output).not.toMatch(UNICODE_BIDI_CONTROL_PATTERN);
		});
	});

	describe("approval count", () => {
		it("prints 0 when queue is empty", async () => {
			const output = await captureOutput(() => run(makeProgram(), "approval", "count"));
			expect(output).toContain("0");
		});

		it("prints correct count", async () => {
			testQueue.enqueue("shell", { command: "a" }, "dangerous", "r");
			testQueue.enqueue("git", { command: "b" }, "dangerous", "r");
			const output = await captureOutput(() => run(makeProgram(), "approval", "count"));
			expect(output).toContain("2");
		});
	});

	describe("approval reject", () => {
		it("rejects a pending item", async () => {
			const item = testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			const output = await captureOutput(() => run(makeProgram(), "approval", "reject", item.id));
			expect(output).toContain("Rejected");
			expect(output).toContain("shell");
		});

		it("rejects with --reason", async () => {
			const item = testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			const output = await captureOutput(() =>
				run(makeProgram(), "approval", "reject", item.id, "--reason", "too risky"),
			);
			expect(output).toContain("too risky");
		});

		it("errors on nonexistent id", async () => {
			const program = makeProgram();
			const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
			const err = await captureStderr(() => run(program, "approval", "reject", "deadbeef"));
			expect(err).toContain("not found");
			exitSpy.mockRestore();
		});

		it("errors on malformed ids", async () => {
			const program = makeProgram();
			const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
			const err = await captureStderr(() => run(program, "approval", "reject", "../abcd1234"));
			expect(err).toContain("invalid approval id");
			exitSpy.mockRestore();
		});
	});

	describe("approval history", () => {
		it("prints empty message when no resolved items", async () => {
			const output = await captureOutput(() => run(makeProgram(), "approval", "history"));
			expect(output).toContain("No resolved approvals");
		});

		it("does not show pending items", async () => {
			testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			const output = await captureOutput(() => run(makeProgram(), "approval", "history"));
			expect(output).toContain("No resolved approvals");
		});

		it("lists approved and rejected items", async () => {
			const a = testQueue.enqueue("shell", { command: "ls" }, "moderate", "reason");
			testQueue.approve(a.id);
			const b = testQueue.enqueue("git", { command: "push" }, "dangerous", "reason");
			testQueue.reject(b.id, "too risky");
			const output = await captureOutput(() => run(makeProgram(), "approval", "history"));
			expect(output).toContain("2 resolved approval(s)");
			expect(output).toContain("status=approved");
			expect(output).toContain("status=rejected");
			expect(output).toContain("shell");
			expect(output).toContain("git");
			expect(output).toContain("too risky");
		});

		it("strips terminal controls from resolved queue text", async () => {
			const approved = testQueue.enqueue("shell", { command: "ls" }, "moderate", "reason", `${OSC_TITLE}approved-source`);
			testQueue.approve(approved.id, `operator ${CSI_RED}note${CSI_RESET}`);
			const rejected = testQueue.enqueue("git", { command: "push" }, "dangerous", "reason", `${C1_OSC_TITLE}rejected-source`);
			testQueue.reject(rejected.id, `reject ${C1_CSI_GREEN}reason${CSI_RESET}`);

			const output = await captureNoColorOutput(() => run(makeProgram(), "approval", "history"));

			expect(output).toContain("operator note");
			expect(output).toContain("reject reason");
			expect(output).toContain("approved-source");
			expect(output).toContain("rejected-source");
			expect(output).not.toMatch(RAW_TERMINAL_CONTROL_PATTERN);
			expect(output).not.toContain(CSI_RED);
			expect(output).not.toContain(OSC_TITLE);
			expect(output).not.toContain(C1_OSC_TITLE);
		});

		it("strips Unicode bidi controls from resolved queue text", async () => {
			const approved = testQueue.enqueue(
				`shell${RIGHT_TO_LEFT_OVERRIDE}`,
				{ command: "ls" },
				"moderate",
				"reason",
				`${LEFT_TO_RIGHT_ISOLATE}approved-source${POP_DIRECTIONAL_ISOLATE}`,
			);
			testQueue.approve(approved.id, `operator ${RIGHT_TO_LEFT_MARK}note`);
			const rejected = testQueue.enqueue(
				`git${LEFT_TO_RIGHT_OVERRIDE}`,
				{ command: "push" },
				"dangerous",
				"reason",
				`${ARABIC_LETTER_MARK}rejected-source`,
			);
			testQueue.reject(rejected.id, `reject ${RIGHT_TO_LEFT_OVERRIDE}reason`);

			const output = await captureNoColorOutput(() => run(makeProgram(), "approval", "history"));

			expect(output).toContain("operator note");
			expect(output).toContain("reject reason");
			expect(output).toContain("approved-source");
			expect(output).toContain("rejected-source");
			expect(output).toContain("shell");
			expect(output).toContain("git");
			expect(output).not.toMatch(UNICODE_BIDI_CONTROL_PATTERN);
		});

		it("filters by --status", async () => {
			const a = testQueue.enqueue("shell", { command: "ls" }, "moderate", "reason");
			testQueue.approve(a.id);
			const b = testQueue.enqueue("git", { command: "push" }, "dangerous", "reason");
			testQueue.reject(b.id);
			const output = await captureOutput(() =>
				run(makeProgram(), "approval", "history", "--status", "approved"),
			);
			expect(output).toContain("shell");
			expect(output).not.toContain("git");
		});

		it("limits results with -n", async () => {
			for (let i = 0; i < 5; i++) {
				const item = testQueue.enqueue("shell", { command: `cmd${i}` }, "moderate", "reason");
				testQueue.approve(item.id);
			}
			const output = await captureOutput(() =>
				run(makeProgram(), "approval", "history", "-n", "2"),
			);
			expect(output).toContain("2 resolved approval(s)");
		});

		it("errors on invalid --status", async () => {
			const program = makeProgram();
			const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
			const err = await captureStderr(() => run(program, "approval", "history", "--status", "bogus"));
			expect(err).toContain("invalid --status");
			exitSpy.mockRestore();
		});

		it("filters by --since duration", async () => {
			// Manually create an old-resolved item and a recent one
			const old = testQueue.enqueue("git", { command: "push" }, "dangerous", "reason");
			testQueue.reject(old.id);
			// Backdate the resolvedAt to 2 hours ago
			const oldItem = testQueue.get(old.id)!;
			oldItem.resolvedAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
			const { writeFileSync } = await import("node:fs");
			const { join } = await import("node:path");
			writeFileSync(join(dir, `${old.id}.json`), JSON.stringify(oldItem, null, 2));

			const recent = testQueue.enqueue("shell", { command: "ls" }, "moderate", "reason");
			testQueue.approve(recent.id);

			const output = await captureOutput(() =>
				run(makeProgram(), "approval", "history", "--since", "1h"),
			);
			expect(output).toContain("shell");
			expect(output).not.toContain("git");
		});
	});

	describe("approval approve-all", () => {
		it("prints empty message when no pending items", async () => {
			const output = await captureOutput(() =>
				run(makeProgram(), "approval", "approve-all", "--yes"),
			);
			expect(output).toContain("No pending approvals");
		});

		it("approves all pending items with --yes", async () => {
			const a = testQueue.enqueue("glob", { pattern: "*.ts" }, "safe", "reason a");
			const b = testQueue.enqueue("shell", { command: "ls" }, "moderate", "reason b");
			vi.mocked(executeTool).mockResolvedValue({ content: "ok" });
			const output = await captureOutput(() =>
				run(makeProgram(), "approval", "approve-all", "--yes"),
			);
			expect(output).toContain("2 pending approval(s)");
			expect(output).toContain(`Approved and executed glob [${a.id}]`);
			expect(output).toContain(`Approved and executed shell [${b.id}]`);
			expect(output).toContain("Done: 2 approved, 0 failed");
			expect(vi.mocked(executeTool)).toHaveBeenCalledTimes(2);
		});

		it("uses daemon execution results for redacted approved items", async () => {
			const item = testQueue.enqueue(
				"shell",
				{ command: "deploy", accessToken: "raw-token" },
				"moderate",
				"reason",
			);
			const baseClient = testApprovalsClient();
			const daemonClient: ApprovalsClient = {
				...baseClient,
				async list() {
					return { approvals: [withRedactedAccessToken(item)] };
				},
				async approve(id, note) {
					const approved = testQueue.approve(id, note);
					return approved
						? {
							ok: true,
							approval: withRedactedAccessToken(approved),
							execution: {
								status: "succeeded",
								output: { redacted: true, reason: "tool-io", bytes: 2 },
							},
						}
						: { ok: false, reason: "not_found" };
				},
			};

			const output = await captureOutput(() =>
				run(makeProgram(daemonClient), "approval", "approve-all", "--yes"),
			);

			expect(output).toContain(`Approved and executed shell [${item.id}]`);
			expect(output).toContain("output redacted by daemon policy");
			expect(output).toContain("Done: 1 approved, 0 failed");
			expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
		});

		it("attaches --note to every approved item", async () => {
			const item = testQueue.enqueue("glob", { pattern: "*.ts" }, "safe", "reason");
			vi.mocked(executeTool).mockResolvedValue({ content: "result" });
			const output = await captureOutput(() =>
				run(makeProgram(), "approval", "approve-all", "--yes", "--note", "batch run"),
			);
			expect(output).toContain("note: batch run");
			expect(testQueue.get(item.id)?.approvalNote).toBe("batch run");
		});

		it("filters by --risk level", async () => {
			testQueue.enqueue("glob", { pattern: "*.ts" }, "safe", "reason a");
			const b = testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason b");
			vi.mocked(executeTool).mockResolvedValue({ content: "ok" });
			const output = await captureOutput(() =>
				run(makeProgram(), "approval", "approve-all", "--yes", "--risk", "dangerous"),
			);
			expect(output).toContain("1 pending approval(s)");
			expect(output).toContain(`Approved and executed shell [${b.id}]`);
			expect(vi.mocked(executeTool)).toHaveBeenCalledTimes(1);
			// low-risk item still pending
			expect(testQueue.list("pending").length).toBe(1);
		});

		it("prints empty message for --risk with no matching items", async () => {
			testQueue.enqueue("glob", { pattern: "*.ts" }, "safe", "reason");
			const output = await captureOutput(() =>
				run(makeProgram(), "approval", "approve-all", "--yes", "--risk", "dangerous"),
			);
			expect(output).toContain('risk level "dangerous"');
		});

		it("skips items that are no longer pending between list and loop", async () => {
			testQueue.enqueue("glob", { pattern: "*.ts" }, "safe", "reason");
			// Simulate item becoming resolved between list() and approve() calls
			vi.spyOn(testQueue, "approve").mockReturnValueOnce(null);
			vi.mocked(executeTool).mockResolvedValue({ content: "ok" });
			const output = await captureOutput(() =>
				run(makeProgram(), "approval", "approve-all", "--yes"),
			);
			expect(output).toContain("Skipped");
			expect(output).toContain("no longer pending");
			expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
		});
	});

	describe("approval reject-all", () => {
		it("prints empty message when no pending items", async () => {
			const output = await captureOutput(() =>
				run(makeProgram(), "approval", "reject-all", "--yes"),
			);
			expect(output).toContain("No pending approvals");
		});

		it("rejects all pending items with --yes", async () => {
			const a = testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason a");
			const b = testQueue.enqueue("git", { command: "push" }, "moderate", "reason b");
			const output = await captureOutput(() =>
				run(makeProgram(), "approval", "reject-all", "--yes"),
			);
			expect(output).toContain("2 pending approval(s)");
			expect(output).toContain(`Rejected shell [${a.id}]`);
			expect(output).toContain(`Rejected git [${b.id}]`);
			expect(output).toContain("Done: 2 rejected");
			expect(testQueue.list("pending").length).toBe(0);
		});

		it("attaches --reason to every rejected item", async () => {
			const item = testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			const output = await captureOutput(() =>
				run(makeProgram(), "approval", "reject-all", "--yes", "--reason", "bad batch"),
			);
			expect(output).toContain("bad batch");
			expect(testQueue.get(item.id)?.rejectionReason).toBe("bad batch");
		});

		it("filters by --risk level", async () => {
			const a = testQueue.enqueue("glob", { pattern: "*.ts" }, "safe", "reason a");
			const b = testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason b");
			const output = await captureOutput(() =>
				run(makeProgram(), "approval", "reject-all", "--yes", "--risk", "dangerous"),
			);
			expect(output).toContain("1 pending approval(s)");
			expect(output).toContain(`Rejected shell [${b.id}]`);
			// safe item still pending
			expect(testQueue.list("pending").length).toBe(1);
			expect(testQueue.get(a.id)?.status).toBe("pending");
		});

		it("prints empty message for --risk with no matching items", async () => {
			testQueue.enqueue("glob", { pattern: "*.ts" }, "safe", "reason");
			const output = await captureOutput(() =>
				run(makeProgram(), "approval", "reject-all", "--yes", "--risk", "dangerous"),
			);
			expect(output).toContain('risk level "dangerous"');
		});

		it("skips items that are no longer pending between list and loop", async () => {
			testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			vi.spyOn(testQueue, "reject").mockReturnValueOnce(null);
			const output = await captureOutput(() =>
				run(makeProgram(), "approval", "reject-all", "--yes"),
			);
			expect(output).toContain("Skipped");
			expect(output).toContain("no longer pending");
		});
	});

	describe("approval approve", () => {
		it("approves and executes a pending item", async () => {
			const item = testQueue.enqueue("glob", { pattern: "*.ts" }, "dangerous", "test reason");
			vi.mocked(executeTool).mockResolvedValue({ content: "file1.ts\nfile2.ts" });
			const output = await captureOutput(() =>
				run(makeProgram(), "approval", "approve", item.id),
			);
			expect(output).toContain("Approved and executed glob");
			expect(output).toContain("file1.ts");
			expect(vi.mocked(executeTool)).toHaveBeenCalledWith("glob", { pattern: "*.ts" });
		});

		it("does not re-execute redacted approvals that the daemon already executed", async () => {
			const item = testQueue.enqueue(
				"shell",
				{ command: "deploy", accessToken: "raw-token" },
				"moderate",
				"reason",
			);
			const baseClient = testApprovalsClient();
			const daemonClient: ApprovalsClient = {
				...baseClient,
				async approve(id, note) {
					const approved = testQueue.approve(id, note);
					return approved
						? {
							ok: true,
							approval: withRedactedAccessToken(approved),
							execution: {
								status: "succeeded",
								output: { redacted: true, reason: "tool-io", bytes: 2 },
							},
						}
						: { ok: false, reason: "not_found" };
				},
			};

			const output = await captureOutput(() =>
				run(makeProgram(daemonClient), "approval", "approve", item.id),
			);

			expect(output).toContain(`Approved and executed shell [${item.id}]`);
			expect(output).toContain("output redacted by daemon policy");
			expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
		});

		it("errors on nonexistent id", async () => {
			const program = makeProgram();
			const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
			const err = await captureStderr(() => run(program, "approval", "approve", "deadbeef"));
			expect(err).toContain("not found");
			exitSpy.mockRestore();
		});

		it("errors on malformed ids", async () => {
			const program = makeProgram();
			const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
			const err = await captureStderr(() => run(program, "approval", "approve", "../abcd1234"));
			expect(err).toContain("invalid approval id");
			exitSpy.mockRestore();
		});
	});
});
