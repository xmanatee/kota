import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initAuditStore, resetAuditStore } from "../extensions/guardrails-audit/store.js";
import { registration, runAudit } from "./audit.js";

function makeTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "audit-tool-test-"));
}

describe("audit tool", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		const store = initAuditStore(tmpDir);
		store.record({ tool: "shell", risk: "moderate", policy: "allow", reason: "shell execution" });
		store.record({ tool: "file_read", risk: "safe", policy: "allow", reason: "read-only tool" });
		store.record({ tool: "shell", risk: "dangerous", policy: "deny", reason: "destructive command pattern detected" });
	});

	afterEach(() => {
		resetAuditStore();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("registration has correct metadata", () => {
		expect(registration.tool.name).toBe("audit");
		expect(registration.risk).toBe("safe");
		expect(registration.group).toBe("management");
	});

	it("query returns all entries by default", async () => {
		const result = await runAudit({});
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("3 entries");
		expect(result.content).toContain("shell");
		expect(result.content).toContain("file_read");
	});

	it("query filters by tool", async () => {
		const result = await runAudit({ tool: "shell" });
		expect(result.content).toContain("2 entries");
		expect(result.content).not.toContain("file_read");
	});

	it("query filters by risk", async () => {
		const result = await runAudit({ risk: "dangerous" });
		expect(result.content).toContain("1 entries");
		expect(result.content).toContain("deny");
	});

	it("query filters by policy", async () => {
		const result = await runAudit({ policy: "deny" });
		expect(result.content).toContain("1 entries");
		expect(result.content).toContain("destructive");
	});

	it("query respects limit", async () => {
		const result = await runAudit({ limit: 1 });
		expect(result.content).toContain("1 entries");
	});

	it("summary mode returns aggregate stats", async () => {
		const result = await runAudit({ mode: "summary" });
		expect(result.content).toContain("Audit Summary");
		expect(result.content).toContain("3 entries");
		expect(result.content).toContain("shell: 2");
		expect(result.content).toContain("allow: 2");
		expect(result.content).toContain("deny: 1");
	});

	it("summary mode filters", async () => {
		const result = await runAudit({ mode: "summary", tool: "file_read" });
		expect(result.content).toContain("1 entries");
	});

	it("returns message when no entries match", async () => {
		const result = await runAudit({ tool: "nonexistent" });
		expect(result.content).toContain("No audit entries");
	});

	it("returns error when audit store not initialized", async () => {
		resetAuditStore();
		const result = await runAudit({});
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("not initialized");
	});

	it("formats entries with timestamp and risk/policy", async () => {
		const result = await runAudit({ limit: 1 });
		// Entry format: [timestamp] tool — risk/policy: reason
		expect(result.content).toMatch(/\[\d{4}-\d{2}-\d{2}.*\] shell — dangerous\/deny: destructive/);
	});
});
