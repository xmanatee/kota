/**
 * Edge-case tests for extension-factory split modules.
 * Covers gaps not addressed by the existing extension-factory.test.ts.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, } from "vitest";
import { initExtensionLogStore, resetExtensionLogStore } from "../../extension-log.js";
import { clearCustomTools } from "../index.js";
import { handleCreate, handleInfo, handleList, handleRemove } from "./actions.js";
import { handleLogs } from "./logs.js";
import {
	addLoadedExtension,
	getLoadedManifestExtensionCount,
	isExtensionLoaded,
	loadedExtensionCount,
	loadedExtensionNames,
	markExtensionLoaded,
	removeLoadedExtension,
	resetExtensionFactory,
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
	resetExtensionFactory();
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
	it("isExtensionLoaded returns false for unloaded extensions", () => {
		expect(isExtensionLoaded("nonexistent")).toBe(false);
	});

	it("addLoadedExtension + isExtensionLoaded round-trip", () => {
		addLoadedExtension("my-mod");
		expect(isExtensionLoaded("my-mod")).toBe(true);
		expect(loadedExtensionCount()).toBe(1);
	});

	it("removeLoadedExtension removes the extension", () => {
		addLoadedExtension("my-mod");
		removeLoadedExtension("my-mod");
		expect(isExtensionLoaded("my-mod")).toBe(false);
		expect(loadedExtensionCount()).toBe(0);
	});

	it("removeLoadedExtension is a no-op for unknown names", () => {
		removeLoadedExtension("nonexistent");
		expect(loadedExtensionCount()).toBe(0);
	});

	it("loadedExtensionNames iterates all loaded names", () => {
		addLoadedExtension("a");
		addLoadedExtension("b");
		addLoadedExtension("c");
		const names = [...loadedExtensionNames()];
		expect(names).toContain("a");
		expect(names).toContain("b");
		expect(names).toContain("c");
		expect(names).toHaveLength(3);
	});

	it("markExtensionLoaded is idempotent", () => {
		markExtensionLoaded("x");
		markExtensionLoaded("x");
		expect(getLoadedManifestExtensionCount()).toBe(1);
	});
});

// ─── Create edge cases ───────────────────────────────────────────────

describe("handleCreate — edge cases", () => {
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
		expect(isExtensionLoaded("second-mod")).toBe(false);
	});

	it("replaces existing module and deregisters old tools", () => {
		handleCreate({
			name: "replace-mod",
			tools: [
				{ name: "old_tool", description: "old", code: "pass" },
			],
		});
		expect(isExtensionLoaded("replace-mod")).toBe(true);

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
		addLoadedExtension("ghost-mod");
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
		addLoadedExtension("phantom-mod");

		const result = handleList();
		expect(result.content).toContain("real-mod");
		expect(result.content).toContain("phantom-mod");
		expect(result.content).toContain("session-only");
		expect(result.content).toContain("Custom extensions (2)");
	});
});

// ─── Remove edge cases ──────────────────────────────────────────────

describe("handleRemove — edge cases", () => {
	it("removes disk-only module not loaded in session", () => {
		// Create and persist, then reset session state (simulates restart)
		handleCreate({ name: "disk-mod", tools: [] });
		removeLoadedExtension("disk-mod");

		// Module is on disk but not in session
		expect(isExtensionLoaded("disk-mod")).toBe(false);

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
		addLoadedExtension("ephemeral");
		const result = handleInfo("ephemeral");
		expect(result.content).toContain("session-only");
		expect(result.content).toContain("not persisted");
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
		removeLoadedExtension("saved-mod");

		const result = handleInfo("saved-mod");
		expect(result.content).toContain("saved (loads on restart)");
	});
});

// ─── Logs edge cases ─────────────────────────────────────────────────

describe("handleLogs — edge cases", () => {
	it("shows data field in log entries", () => {
		const store = initExtensionLogStore(tmpDir);
		store.append("data-mod", "info", "with data", { key: "value" });

		const result = handleLogs({ name: "data-mod" });
		expect(result.content).toContain("with data");
		expect(result.content).toContain('"key":"value"');
		resetExtensionLogStore();
	});

	it("combines level and keyword filters", () => {
		const store = initExtensionLogStore(tmpDir);
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
		resetExtensionLogStore();
	});

	it("shows filter description when no entries match", () => {
		const store = initExtensionLogStore(tmpDir);
		store.append("some-mod", "info", "hello");

		const result = handleLogs({
			name: "some-mod",
			level: "error",
			keyword: "crash",
		});
		expect(result.content).toContain("No log entries");
		expect(result.content).toContain('level=error');
		expect(result.content).toContain('keyword="crash"');
		resetExtensionLogStore();
	});

	it("default limit is 30", () => {
		const store = initExtensionLogStore(tmpDir);
		for (let i = 0; i < 50; i++) {
			store.append("many-logs", "info", `msg-${i}`);
		}

		const result = handleLogs({ name: "many-logs" });
		expect(result.content).toContain("30 entries");
		resetExtensionLogStore();
	});
});
