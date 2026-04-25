import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue, resetApprovalQueue } from "#core/daemon/approval-queue.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { registerApprovalCommands } from "./cli.js";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
function stubCtx(): ModuleContext {
	return {
		client: {
			approvals: {
				async list(filter?: { status?: string }) {
					testQueue.expireStale(DEFAULT_TTL_MS);
					const status = filter?.status;
					if (status === undefined) return { approvals: testQueue.list("pending") };
					if (status === "all") return { approvals: testQueue.list() };
					return { approvals: testQueue.list(status as Parameters<typeof testQueue.list>[0]) };
				},
				async approve(id: string, note?: string) {
					const item = testQueue.approve(id, note);
					return item ? { ok: true, approval: item } : { ok: false, reason: "not_found" };
				},
				async reject(id: string, reason?: string) {
					const item = testQueue.reject(id, reason);
					return item ? { ok: true, approval: item } : { ok: false, reason: "not_found" };
				},
			},
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


function makeProgram(): Command {
	const program = new Command();
	program.exitOverride(); // prevent process.exit in tests
	registerApprovalCommands(program, stubCtx());
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
			const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
			await expect(run(program, "approval", "reject", "nonexistent")).rejects.toThrow("exit");
			expect(errSpy.mock.calls.flat().join("")).toContain("not found");
			errSpy.mockRestore();
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
			const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
			await expect(run(program, "approval", "history", "--status", "bogus")).rejects.toThrow("exit");
			expect(errSpy.mock.calls.flat().join("")).toContain("invalid --status");
			errSpy.mockRestore();
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

		it("errors on nonexistent id", async () => {
			const program = makeProgram();
			const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
			await expect(run(program, "approval", "approve", "nonexistent")).rejects.toThrow("exit");
			expect(errSpy.mock.calls.flat().join("")).toContain("not found");
			errSpy.mockRestore();
			exitSpy.mockRestore();
		});
	});
});
