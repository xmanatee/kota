import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "#core/tools/audit-store.js";
import { AuditStore } from "#core/tools/audit-store.js";
import { registerAuditCommands } from "./cli.js";

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
	return {
		ts: "2026-01-01T12:00:00.000Z",
		tool: "bash",
		risk: "moderate",
		policy: "confirm",
		reason: "shell execution",
		...overrides,
	};
}

describe("audit-cli", () => {
	let outputLines: string[];
	let querySpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		outputLines = [];
		vi.spyOn(console, "log").mockImplementation((...args) => {
			outputLines.push(`${args.join(" ")}\n`);
		});
		vi.spyOn(process.stdout, "write").mockImplementation((data) => {
			outputLines.push(String(data));
			return true;
		});
		querySpy = vi.spyOn(AuditStore.prototype, "query").mockReturnValue([]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function captured(): string {
		return outputLines.join("");
	}

	async function run(args: string[]): Promise<void> {
		const program = new Command();
		program.exitOverride();
		registerAuditCommands(program);
		await program.parseAsync(["node", "kota", ...args]);
	}

	describe("audit list", () => {
		it("prints no entries message when store is empty", async () => {
			querySpy.mockReturnValue([]);
			await run(["audit", "list"]);
			expect(captured()).toContain("No audit entries.");
		});

		it("prints table with entries", async () => {
			querySpy.mockReturnValue([makeEntry({ tool: "file_read", risk: "safe", policy: "allow" })]);
			await run(["audit", "list"]);
			const output = captured();
			expect(output).toContain("file_read");
			expect(output).toContain("safe");
			expect(output).toContain("allow");
		});

		it("passes risk filter to store", async () => {
			await run(["audit", "list", "--risk", "dangerous"]);
			expect(querySpy).toHaveBeenCalledWith(expect.objectContaining({ risk: "dangerous" }));
		});

		it("passes policy filter to store", async () => {
			await run(["audit", "list", "--policy", "deny"]);
			expect(querySpy).toHaveBeenCalledWith(expect.objectContaining({ policy: "deny" }));
		});

		it("passes limit to store", async () => {
			await run(["audit", "list", "-n", "10"]);
			expect(querySpy).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }));
		});

		it("uses default limit of 50", async () => {
			await run(["audit", "list"]);
			expect(querySpy).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
		});

		it("displays session column", async () => {
			querySpy.mockReturnValue([makeEntry({ session: "sess-abc123" })]);
			await run(["audit", "list"]);
			expect(captured()).toContain("sess-abc123");
		});

		it("shows dash for missing session", async () => {
			querySpy.mockReturnValue([makeEntry()]);
			await run(["audit", "list"]);
			// The row should have a dash in the session column
			expect(captured()).toMatch(/-\s+bash/);
		});
	});
});
