import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerApprovalCommands } from "./approval-cli.js";
import { ApprovalQueue, resetApprovalQueue } from "./approval-queue.js";

vi.mock("./event-bus.js", () => ({
	tryEmit: vi.fn(),
	getEventBus: () => null,
}));

let testQueue: ApprovalQueue;
vi.mock("./approval-queue.js", async (importOriginal) => {
	const mod = await importOriginal<typeof import("./approval-queue.js")>();
	return {
		...mod,
		getApprovalQueue: () => testQueue,
	};
});

vi.mock("./tools/index.js", () => ({
	executeTool: vi.fn(),
}));

import { executeTool } from "./tools/index.js";

function makeProgram(): Command {
	const program = new Command();
	program.exitOverride(); // prevent process.exit in tests
	registerApprovalCommands(program);
	return program;
}

async function run(program: Command, ...args: string[]): Promise<void> {
	await program.parseAsync(["node", "cli", ...args]);
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
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "list");
			expect(logSpy.mock.calls.flat().join(" ")).toContain("No pending approvals");
			logSpy.mockRestore();
		});

		it("lists pending items with id, tool, risk, and reason", async () => {
			testQueue.enqueue("shell", { command: "rm -rf /tmp" }, "dangerous", "destructive op");
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "list");
			const output = logSpy.mock.calls.flat().join("\n");
			expect(output).toContain("shell");
			expect(output).toContain("dangerous");
			expect(output).toContain("destructive op");
			logSpy.mockRestore();
		});
	});

	describe("approval count", () => {
		it("prints 0 when queue is empty", async () => {
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "count");
			expect(logSpy.mock.calls.flat().join("")).toContain("0");
			logSpy.mockRestore();
		});

		it("prints correct count", async () => {
			testQueue.enqueue("shell", { command: "a" }, "dangerous", "r");
			testQueue.enqueue("git", { command: "b" }, "dangerous", "r");
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "count");
			expect(logSpy.mock.calls.flat().join("")).toContain("2");
			logSpy.mockRestore();
		});
	});

	describe("approval reject", () => {
		it("rejects a pending item", async () => {
			const item = testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "reject", item.id);
			const output = logSpy.mock.calls.flat().join("\n");
			expect(output).toContain("Rejected");
			expect(output).toContain("shell");
			logSpy.mockRestore();
		});

		it("rejects with --reason", async () => {
			const item = testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "reject", item.id, "--reason", "too risky");
			const output = logSpy.mock.calls.flat().join("\n");
			expect(output).toContain("too risky");
			logSpy.mockRestore();
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
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "history");
			expect(logSpy.mock.calls.flat().join(" ")).toContain("No resolved approvals");
			logSpy.mockRestore();
		});

		it("does not show pending items", async () => {
			testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "history");
			expect(logSpy.mock.calls.flat().join(" ")).toContain("No resolved approvals");
			logSpy.mockRestore();
		});

		it("lists approved and rejected items", async () => {
			const a = testQueue.enqueue("shell", { command: "ls" }, "moderate", "reason");
			testQueue.approve(a.id);
			const b = testQueue.enqueue("git", { command: "push" }, "dangerous", "reason");
			testQueue.reject(b.id, "too risky");
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "history");
			const output = logSpy.mock.calls.flat().join("\n");
			expect(output).toContain("2 resolved approval(s)");
			expect(output).toContain("status=approved");
			expect(output).toContain("status=rejected");
			expect(output).toContain("shell");
			expect(output).toContain("git");
			expect(output).toContain("too risky");
			logSpy.mockRestore();
		});

		it("filters by --status", async () => {
			const a = testQueue.enqueue("shell", { command: "ls" }, "moderate", "reason");
			testQueue.approve(a.id);
			const b = testQueue.enqueue("git", { command: "push" }, "dangerous", "reason");
			testQueue.reject(b.id);
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "history", "--status", "approved");
			const output = logSpy.mock.calls.flat().join("\n");
			expect(output).toContain("shell");
			expect(output).not.toContain("git");
			logSpy.mockRestore();
		});

		it("limits results with -n", async () => {
			for (let i = 0; i < 5; i++) {
				const item = testQueue.enqueue("shell", { command: `cmd${i}` }, "moderate", "reason");
				testQueue.approve(item.id);
			}
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "history", "-n", "2");
			const output = logSpy.mock.calls.flat().join("\n");
			expect(output).toContain("2 resolved approval(s)");
			logSpy.mockRestore();
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

			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "history", "--since", "1h");
			const output = logSpy.mock.calls.flat().join("\n");
			expect(output).toContain("shell");
			expect(output).not.toContain("git");
			logSpy.mockRestore();
		});
	});

	describe("approval approve-all", () => {
		it("prints empty message when no pending items", async () => {
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "approve-all", "--yes");
			expect(logSpy.mock.calls.flat().join(" ")).toContain("No pending approvals");
			logSpy.mockRestore();
		});

		it("approves all pending items with --yes", async () => {
			const a = testQueue.enqueue("glob", { pattern: "*.ts" }, "safe", "reason a");
			const b = testQueue.enqueue("shell", { command: "ls" }, "moderate", "reason b");
			vi.mocked(executeTool).mockResolvedValue({ content: "ok" });
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "approve-all", "--yes");
			const output = logSpy.mock.calls.flat().join("\n");
			expect(output).toContain("2 pending approval(s)");
			expect(output).toContain(`Approved and executed glob [${a.id}]`);
			expect(output).toContain(`Approved and executed shell [${b.id}]`);
			expect(output).toContain("Done: 2 approved, 0 failed");
			expect(vi.mocked(executeTool)).toHaveBeenCalledTimes(2);
			logSpy.mockRestore();
		});

		it("attaches --note to every approved item", async () => {
			const item = testQueue.enqueue("glob", { pattern: "*.ts" }, "safe", "reason");
			vi.mocked(executeTool).mockResolvedValue({ content: "result" });
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "approve-all", "--yes", "--note", "batch run");
			const output = logSpy.mock.calls.flat().join("\n");
			expect(output).toContain("note: batch run");
			expect(testQueue.get(item.id)?.approvalNote).toBe("batch run");
			logSpy.mockRestore();
		});

		it("filters by --risk level", async () => {
			testQueue.enqueue("glob", { pattern: "*.ts" }, "safe", "reason a");
			const b = testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason b");
			vi.mocked(executeTool).mockResolvedValue({ content: "ok" });
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "approve-all", "--yes", "--risk", "dangerous");
			const output = logSpy.mock.calls.flat().join("\n");
			expect(output).toContain("1 pending approval(s)");
			expect(output).toContain(`Approved and executed shell [${b.id}]`);
			expect(vi.mocked(executeTool)).toHaveBeenCalledTimes(1);
			// low-risk item still pending
			expect(testQueue.list("pending").length).toBe(1);
			logSpy.mockRestore();
		});

		it("prints empty message for --risk with no matching items", async () => {
			testQueue.enqueue("glob", { pattern: "*.ts" }, "safe", "reason");
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "approve-all", "--yes", "--risk", "dangerous");
			const output = logSpy.mock.calls.flat().join(" ");
			expect(output).toContain('risk level "dangerous"');
			logSpy.mockRestore();
		});

		it("skips items that are no longer pending between list and loop", async () => {
			testQueue.enqueue("glob", { pattern: "*.ts" }, "safe", "reason");
			// Simulate item becoming resolved between list() and approve() calls
			vi.spyOn(testQueue, "approve").mockReturnValueOnce(null);
			vi.mocked(executeTool).mockResolvedValue({ content: "ok" });
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "approve-all", "--yes");
			const output = logSpy.mock.calls.flat().join("\n");
			expect(output).toContain("Skipped");
			expect(output).toContain("no longer pending");
			expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
			logSpy.mockRestore();
		});
	});

	describe("approval reject-all", () => {
		it("prints empty message when no pending items", async () => {
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "reject-all", "--yes");
			expect(logSpy.mock.calls.flat().join(" ")).toContain("No pending approvals");
			logSpy.mockRestore();
		});

		it("rejects all pending items with --yes", async () => {
			const a = testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason a");
			const b = testQueue.enqueue("git", { command: "push" }, "moderate", "reason b");
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "reject-all", "--yes");
			const output = logSpy.mock.calls.flat().join("\n");
			expect(output).toContain("2 pending approval(s)");
			expect(output).toContain(`Rejected shell [${a.id}]`);
			expect(output).toContain(`Rejected git [${b.id}]`);
			expect(output).toContain("Done: 2 rejected");
			expect(testQueue.list("pending").length).toBe(0);
			logSpy.mockRestore();
		});

		it("attaches --reason to every rejected item", async () => {
			const item = testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "reject-all", "--yes", "--reason", "bad batch");
			const output = logSpy.mock.calls.flat().join("\n");
			expect(output).toContain("bad batch");
			expect(testQueue.get(item.id)?.rejectionReason).toBe("bad batch");
			logSpy.mockRestore();
		});

		it("filters by --risk level", async () => {
			const a = testQueue.enqueue("glob", { pattern: "*.ts" }, "safe", "reason a");
			const b = testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason b");
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "reject-all", "--yes", "--risk", "dangerous");
			const output = logSpy.mock.calls.flat().join("\n");
			expect(output).toContain("1 pending approval(s)");
			expect(output).toContain(`Rejected shell [${b.id}]`);
			// safe item still pending
			expect(testQueue.list("pending").length).toBe(1);
			expect(testQueue.get(a.id)?.status).toBe("pending");
			logSpy.mockRestore();
		});

		it("prints empty message for --risk with no matching items", async () => {
			testQueue.enqueue("glob", { pattern: "*.ts" }, "safe", "reason");
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "reject-all", "--yes", "--risk", "dangerous");
			const output = logSpy.mock.calls.flat().join(" ");
			expect(output).toContain('risk level "dangerous"');
			logSpy.mockRestore();
		});

		it("skips items that are no longer pending between list and loop", async () => {
			testQueue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
			vi.spyOn(testQueue, "reject").mockReturnValueOnce(null);
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "reject-all", "--yes");
			const output = logSpy.mock.calls.flat().join("\n");
			expect(output).toContain("Skipped");
			expect(output).toContain("no longer pending");
			logSpy.mockRestore();
		});
	});

	describe("approval approve", () => {
		it("approves and executes a pending item", async () => {
			const item = testQueue.enqueue("glob", { pattern: "*.ts" }, "dangerous", "test reason");
			vi.mocked(executeTool).mockResolvedValue({ content: "file1.ts\nfile2.ts" });
			const program = makeProgram();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await run(program, "approval", "approve", item.id);
			const output = logSpy.mock.calls.flat().join("\n");
			expect(output).toContain("Approved and executed glob");
			expect(output).toContain("file1.ts");
			expect(vi.mocked(executeTool)).toHaveBeenCalledWith("glob", { pattern: "*.ts" });
			logSpy.mockRestore();
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
