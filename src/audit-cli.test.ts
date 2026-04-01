import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAuditCommands } from "./audit-cli.js";
import type { AuditEntry } from "./guardrails-audit.js";
import { AuditStore } from "./guardrails-audit.js";

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
	let consoleSpy: ReturnType<typeof vi.spyOn>;
	let querySpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		querySpy = vi.spyOn(AuditStore.prototype, "query").mockReturnValue([]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

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
			expect(consoleSpy).toHaveBeenCalledWith("No audit entries.");
		});

		it("prints table with entries", async () => {
			querySpy.mockReturnValue([makeEntry({ tool: "file_read", risk: "safe", policy: "allow" })]);
			await run(["audit", "list"]);
			const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0] as string).join("\n");
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
			const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0] as string).join("\n");
			expect(output).toContain("sess-abc123");
		});

		it("shows dash for missing session", async () => {
			querySpy.mockReturnValue([makeEntry()]);
			await run(["audit", "list"]);
			const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0] as string).join("\n");
			// The row should have a dash in the session column
			expect(output).toMatch(/-\s+bash/);
		});
	});
});
