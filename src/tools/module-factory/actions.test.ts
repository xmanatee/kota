/**
 * Edge-case tests for module-factory split modules.
 * Covers gaps not addressed by the existing module-factory.test.ts.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, } from "vitest";
import { initModuleLogStore, resetModuleLogStore } from "../../module-log.js";
import { clearCustomTools } from "../index.js";
import { handleCreate, handleInfo, handleList, handleRemove } from "./actions.js";
import { handleLogs } from "./logs.js";
import { handleRun } from "./scripts.js";
import {
	addLoadedModule,
	getLoadedManifestModuleCount,
	isModuleLoaded,
	loadedModuleCount,
	loadedModuleNames,
	markModuleLoaded,
	removeLoadedModule,
	resetModuleFactory,
} from "./state.js";

let originalCwd: string;
let tmpDir: string;

beforeEach(() => {
	originalCwd = process.cwd();
	tmpDir = join(
		tmpdir(),
		`kota-mfsplit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
	process.chdir(tmpDir);
});

afterEach(() => {
	process.chdir(originalCwd);
	clearCustomTools();
	resetModuleFactory();
	try {
		rmSync(tmpDir, { recursive: true });
	} catch {
		/* ignore */
	}
});

const _sampleManifest = {
	name: "test-mod",
	version: "1.0.0",
	description: "A test module",
	tools: [
		{
			name: "test_tool",
			description: "A test tool",
			code: "print('hello')",
		},
	],
};

// ─── State module ─────────────────────────────────────────────────────

describe("state — granular operations", () => {
	it("isModuleLoaded returns false for unloaded modules", () => {
		expect(isModuleLoaded("nonexistent")).toBe(false);
	});

	it("addLoadedModule + isModuleLoaded round-trip", () => {
		addLoadedModule("my-mod");
		expect(isModuleLoaded("my-mod")).toBe(true);
		expect(loadedModuleCount()).toBe(1);
	});

	it("removeLoadedModule removes the module", () => {
		addLoadedModule("my-mod");
		removeLoadedModule("my-mod");
		expect(isModuleLoaded("my-mod")).toBe(false);
		expect(loadedModuleCount()).toBe(0);
	});

	it("removeLoadedModule is a no-op for unknown names", () => {
		removeLoadedModule("nonexistent");
		expect(loadedModuleCount()).toBe(0);
	});

	it("loadedModuleNames iterates all loaded names", () => {
		addLoadedModule("a");
		addLoadedModule("b");
		addLoadedModule("c");
		const names = [...loadedModuleNames()];
		expect(names).toContain("a");
		expect(names).toContain("b");
		expect(names).toContain("c");
		expect(names).toHaveLength(3);
	});

	it("markModuleLoaded is idempotent", () => {
		markModuleLoaded("x");
		markModuleLoaded("x");
		expect(getLoadedManifestModuleCount()).toBe(1);
	});
});

// ─── Create edge cases ───────────────────────────────────────────────

describe("handleCreate — edge cases", () => {
	it("creates module with promptSection and includes note", () => {
		const manifest = {
			name: "prompt-mod",
			promptSection: "Always be helpful.",
			tools: [],
		};
		const result = handleCreate(manifest);
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("Prompt section will be active");
	});

	it("creates module with no tools", () => {
		const manifest = { name: "empty-mod", tools: [] };
		const result = handleCreate(manifest);
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("Tools: none");
	});

	it("creates module with default version when omitted", () => {
		const manifest = { name: "no-ver", tools: [] };
		const result = handleCreate(manifest);
		expect(result.content).toContain("1.0.0");
	});

	it("handles persistence failure gracefully (session-only)", () => {
		// Make .kota dir unwritable by pre-creating as a file
		writeFileSync(join(tmpDir, ".kota"), "blocker");
		const manifest = {
			name: "persist-fail",
			tools: [{ name: "pf_tool", description: "test", code: "pass" }],
		};
		const result = handleCreate(manifest);
		// Should not be an error — module is usable session-only
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("session-only");
		expect(result.content).toContain("failed to persist");
		expect(result.content).toContain("1 tool(s) registered");
	});

	it("rolls back tools on registration failure (duplicate name)", () => {
		// Create first module with a tool
		handleCreate({
			name: "first-mod",
			tools: [{ name: "dup_tool", description: "first", code: "pass" }],
		});

		// Create second module with same tool name — should fail
		const result = handleCreate({
			name: "second-mod",
			tools: [{ name: "dup_tool", description: "second", code: "pass" }],
		});
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("Error registering tool");
		expect(result.content).toContain("dup_tool");

		// second-mod should NOT be loaded
		expect(isModuleLoaded("second-mod")).toBe(false);
	});

	it("replaces existing module and deregisters old tools", () => {
		handleCreate({
			name: "replace-mod",
			tools: [
				{ name: "old_tool", description: "old", code: "pass" },
			],
		});
		expect(isModuleLoaded("replace-mod")).toBe(true);

		// Replace with different tools
		const result = handleCreate({
			name: "replace-mod",
			tools: [
				{ name: "new_tool", description: "new", code: "pass" },
			],
		});
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("new_tool");
	});
});

// ─── List edge cases ─────────────────────────────────────────────────

describe("handleList — edge cases", () => {
	it("shows session-only modules without disk persistence", () => {
		// Add a module to loaded set without saving to disk
		addLoadedModule("ghost-mod");
		const result = handleList();
		expect(result.content).toContain("ghost-mod");
		expect(result.content).toContain("session-only");
	});

	it("shows both persisted and session-only modules", () => {
		// Create a real persisted module
		handleCreate({
			name: "real-mod",
			description: "Persisted",
			tools: [],
		});
		// Add a session-only one
		addLoadedModule("phantom-mod");

		const result = handleList();
		expect(result.content).toContain("real-mod");
		expect(result.content).toContain("phantom-mod");
		expect(result.content).toContain("session-only");
		expect(result.content).toContain("Custom modules (2)");
	});
});

// ─── Remove edge cases ──────────────────────────────────────────────

describe("handleRemove — edge cases", () => {
	it("removes disk-only module not loaded in session", () => {
		// Create and persist, then reset session state (simulates restart)
		handleCreate({ name: "disk-mod", tools: [] });
		removeLoadedModule("disk-mod");

		// Module is on disk but not in session
		expect(isModuleLoaded("disk-mod")).toBe(false);

		const result = handleRemove("disk-mod");
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("removed");
		expect(result.content).toContain("Manifest deleted");
		expect(result.content).not.toContain("Tools deregistered");
	});
});

// ─── Info edge cases ─────────────────────────────────────────────────

describe("handleInfo — edge cases", () => {
	it("shows session-only status for loaded-but-not-persisted module", () => {
		addLoadedModule("ephemeral");
		const result = handleInfo("ephemeral");
		expect(result.content).toContain("session-only");
		expect(result.content).toContain("not persisted");
	});

	it("truncates long promptSection preview", () => {
		const longPrompt = "A".repeat(300);
		handleCreate({
			name: "long-prompt-mod",
			promptSection: longPrompt,
			tools: [],
		});
		const result = handleInfo("long-prompt-mod");
		expect(result.content).toContain("Prompt section:");
		expect(result.content).toContain("...");
		// Should be truncated to ~200 chars
		expect(result.content).not.toContain("A".repeat(300));
	});

	it("shows dependencies in info output", () => {
		handleCreate({
			name: "dep-mod",
			dependencies: ["axios", "lodash"],
			tools: [],
		});
		const result = handleInfo("dep-mod");
		expect(result.content).toContain("Dependencies: axios, lodash");
	});

	it("shows tool parameters in info output", () => {
		handleCreate({
			name: "param-mod",
			tools: [
				{
					name: "param_tool",
					description: "tool with params",
					code: "print(x)",
					parameters: {
						type: "object",
						properties: { x: { type: "string" }, y: { type: "number" } },
					},
				},
			],
		});
		const result = handleInfo("param-mod");
		expect(result.content).toContain("param_tool(x, y)");
	});

	it("shows status as saved when module not loaded in session", () => {
		handleCreate({ name: "saved-mod", tools: [] });
		removeLoadedModule("saved-mod");

		const result = handleInfo("saved-mod");
		expect(result.content).toContain("saved (loads on restart)");
	});
});

// ─── Scripts edge cases ──────────────────────────────────────────────

describe("handleRun — edge cases", () => {
	it("handles undefined args gracefully", async () => {
		handleCreate({
			name: "script-mod",
			scripts: {
				greet: {
					steps: [{ tool: "shell", input: { command: "echo hi" } }],
				},
			},
		});
		// Pass empty args — should not throw
		const result = await handleRun("script-mod", "greet", {});
		// We can't assert success (requires tool runner) but it shouldn't crash
		expect(result).toBeDefined();
	});
});

// ─── Logs edge cases ─────────────────────────────────────────────────

describe("handleLogs — edge cases", () => {
	it("shows data field in log entries", () => {
		const store = initModuleLogStore(tmpDir);
		store.append("data-mod", "info", "with data", { key: "value" });

		const result = handleLogs({ name: "data-mod" });
		expect(result.content).toContain("with data");
		expect(result.content).toContain('"key":"value"');
		resetModuleLogStore();
	});

	it("combines level and keyword filters", () => {
		const store = initModuleLogStore(tmpDir);
		store.append("filter-mod", "info", "info about weather");
		store.append("filter-mod", "error", "error about weather");
		store.append("filter-mod", "info", "info about sports");

		const result = handleLogs({
			name: "filter-mod",
			level: "info",
			keyword: "weather",
		});
		expect(result.content).toContain("info about weather");
		expect(result.content).not.toContain("error about weather");
		expect(result.content).not.toContain("sports");
		expect(result.content).toContain("1 entries");
		resetModuleLogStore();
	});

	it("shows filter description when no entries match", () => {
		const store = initModuleLogStore(tmpDir);
		store.append("some-mod", "info", "hello");

		const result = handleLogs({
			name: "some-mod",
			level: "error",
			keyword: "crash",
		});
		expect(result.content).toContain("No log entries");
		expect(result.content).toContain('level=error');
		expect(result.content).toContain('keyword="crash"');
		resetModuleLogStore();
	});

	it("default limit is 30", () => {
		const store = initModuleLogStore(tmpDir);
		for (let i = 0; i < 50; i++) {
			store.append("many-logs", "info", `msg-${i}`);
		}

		const result = handleLogs({ name: "many-logs" });
		expect(result.content).toContain("30 entries");
		resetModuleLogStore();
	});
});
