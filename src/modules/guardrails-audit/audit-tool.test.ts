import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildModuleCapabilityManifestProjection,
	clearModuleCapabilityManifestProjections,
	registerModuleCapabilityManifestProjection,
} from "#core/modules/module-manifest.js";
import { initAuditStore, resetAuditStore } from "#core/tools/audit-store.js";
import { networkWriteEffect } from "#core/tools/effect.js";
import { auditTool, runAudit } from "./audit-tool.js";

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
		clearModuleCapabilityManifestProjections();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("tool has correct metadata", () => {
		expect(auditTool.name).toBe("audit");
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

	it("includes manifest capability and data context for matching tools", async () => {
		registerModuleCapabilityManifestProjection(
			buildModuleCapabilityManifestProjection(
				"shell-module",
				{
					schemaVersion: 1,
					capabilities: [
						{
							id: "shell-module.commands",
							description: "Runs shell commands.",
							scope: "daemon",
							scopePolicyHooks: ["writes"],
						},
					],
					dataClasses: [
						{
							id: "shell-module.command",
							description: "Command text.",
							sensitivity: "internal",
							retention: "operator-visible",
							redaction: "metadata-only",
						},
					],
					simulation: {
						support: "external-effects-blocked",
						blockedReasons: ["Shell writes are blocked in trial mode."],
					},
				},
				{
					dependencies: [],
					tools: [
						{
							name: "shell",
							description: "Shell command",
							effect: networkWriteEffect(),
						},
					],
					effects: [],
					workflows: [],
					workflowTriggers: [],
					channels: [],
					skills: [],
					agents: [],
					commands: [],
					routes: [],
					controlRoutes: [],
					events: [],
					eventFlows: [],
					localClientNamespaces: [],
					hasDaemonClientFactory: false,
					setupRequirements: [],
					hasHealthCheck: false,
				},
			),
		);

		const result = await runAudit({ tool: "shell", limit: 1 });

		expect(result.content).toContain("module=shell-module");
		expect(result.content).toContain("capabilities=shell-module.commands");
		expect(result.content).toContain("data=shell-module.command");
	});
});
