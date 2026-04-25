import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import type {
	AuditClient,
	AuditListEntry,
	KotaClient,
} from "#core/server/kota-client.js";
import type { AuditEntry } from "#core/tools/audit-store.js";
import { registerAuditCommands } from "./cli.js";

function makeFakeCtx(client: AuditClient): ModuleContext {
	return {
		client: { audit: client } as unknown as KotaClient,
	} as unknown as ModuleContext;
}

function entryToList(entry: AuditEntry): AuditListEntry {
	return {
		ts: entry.ts,
		tool: entry.tool,
		risk: entry.risk,
		policy: entry.policy,
		reason: entry.reason,
		...(entry.session !== undefined && { session: entry.session }),
	};
}

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
	let listSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		outputLines = [];
		vi.spyOn(console, "log").mockImplementation((...args) => {
			outputLines.push(`${args.join(" ")}\n`);
		});
		vi.spyOn(process.stdout, "write").mockImplementation((data) => {
			outputLines.push(String(data));
			return true;
		});
		listSpy = vi.fn(async () => ({ entries: [] }));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function captured(): string {
		return outputLines.join("");
	}

	function setListEntries(entries: AuditEntry[]): void {
		listSpy.mockResolvedValue({ entries: entries.map(entryToList) });
	}

	async function run(args: string[]): Promise<void> {
		const program = new Command();
		program.exitOverride();
		const client: AuditClient = { list: listSpy as unknown as AuditClient["list"] };
		registerAuditCommands(program, makeFakeCtx(client));
		await program.parseAsync(["node", "kota", ...args]);
	}

	describe("audit list", () => {
		it("prints no entries message when store is empty", async () => {
			setListEntries([]);
			await run(["audit", "list"]);
			expect(captured()).toContain("No audit entries.");
		});

		it("prints table with entries", async () => {
			setListEntries([makeEntry({ tool: "file_read", risk: "safe", policy: "allow" })]);
			await run(["audit", "list"]);
			const output = captured();
			expect(output).toContain("file_read");
			expect(output).toContain("safe");
			expect(output).toContain("allow");
		});

		it("passes risk filter to store", async () => {
			await run(["audit", "list", "--risk", "dangerous"]);
			expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ risk: "dangerous" }));
		});

		it("passes policy filter to store", async () => {
			await run(["audit", "list", "--policy", "deny"]);
			expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ policy: "deny" }));
		});

		it("passes limit to store", async () => {
			await run(["audit", "list", "-n", "10"]);
			expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }));
		});

		it("uses default limit of 50", async () => {
			await run(["audit", "list"]);
			expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
		});

		it("displays session column", async () => {
			setListEntries([makeEntry({ session: "sess-abc123" })]);
			await run(["audit", "list"]);
			expect(captured()).toContain("sess-abc123");
		});

		it("shows dash for missing session", async () => {
			setListEntries([makeEntry()]);
			await run(["audit", "list"]);
			expect(captured()).toMatch(/-\s+bash/);
		});
	});
});
