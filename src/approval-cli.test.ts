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
