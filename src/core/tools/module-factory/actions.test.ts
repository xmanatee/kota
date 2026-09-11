/**
 * Edge-case tests for module-factory split files.
 * Covers gaps not addressed by the existing module-factory.test.ts.
 */

import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, } from "vitest";
import { ModuleLogStore } from "#core/modules/module-log.js";
import { clearCustomTools } from "#core/tools/index.js";
import { handleCreate, handleInfo } from "./actions.js";
import { runModuleFactory } from "./index.js";
import { handleLogs } from "./logs.js";

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
	try {
		rmSync(tmpDir, { recursive: true });
	} catch {
		/* ignore */
	}
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

	it("reports failed persistence without activating tools", () => {
		// Make .kota dir unwritable by pre-creating as a file
		writeFileSync(join(tmpDir, ".kota"), "blocker");
		const manifest = {
			name: "persist-fail",
			tools: [{ name: "pf_tool", description: "test", code: "pass" }],
		};
		const result = handleCreate(manifest);
		// A failed save must remain a failure.
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("Failed to save");
	});

});

// ─── Info edge cases ─────────────────────────────────────────────────

describe("handleInfo — edge cases", () => {

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

		const result = handleInfo("saved-mod");
		expect(result.content).toContain("Status: saved");
	});
});

// ─── Logs edge cases ─────────────────────────────────────────────────

describe("handleLogs — edge cases", () => {
	it("shows data field in log entries", () => {
		const store = new ModuleLogStore(tmpDir);
		store.append("data-mod", "info", "with data", { key: "value" });

		const result = handleLogs({ name: "data-mod" }, { scopeRoot: tmpDir });
		expect(result.content).toContain("with data");
		expect(result.content).toContain('"key":"value"');
	});

	it("combines level and keyword filters", () => {
		const store = new ModuleLogStore(tmpDir);
		store.append("filter-mod", "info", "info about weather");
		store.append("filter-mod", "error", "error about weather");
		store.append("filter-mod", "info", "info about sports");

		const result = handleLogs({
			name: "filter-mod",
			level: "info",
			keyword: "weather",
		}, { scopeRoot: tmpDir });
		expect(result.content).toContain("info about weather");
		expect(result.content).not.toContain("error about weather");
		expect(result.content).not.toContain("sports");
		expect(result.content).toContain("1 entries");
	});

	it("shows filter description when no entries match", () => {
		const store = new ModuleLogStore(tmpDir);
		store.append("some-mod", "info", "hello");

		const result = handleLogs({
			name: "some-mod",
			level: "error",
			keyword: "crash",
		}, { scopeRoot: tmpDir });
		expect(result.content).toContain("No log entries");
		expect(result.content).toContain('level=error');
		expect(result.content).toContain('keyword="crash"');
	});

	it("default limit is 30", () => {
		const store = new ModuleLogStore(tmpDir);
		for (let i = 0; i < 50; i++) {
			store.append("many-logs", "info", `msg-${i}`);
		}

		const result = handleLogs({ name: "many-logs" }, { scopeRoot: tmpDir });
		expect(result.content).toContain("30 entries");
	});
});

// Production runner -> manifest persistence -> physical filesystem owner.
it("confines authoring and log inspection when a module directory points outside", async () => {
  const outside = join(tmpDir, "outside");
  const modules = join(tmpDir, ".kota", "modules");
  mkdirSync(outside);
  mkdirSync(modules, { recursive: true });
  const content = JSON.stringify({ name: "audit-probe", description: "outside sentinel" });
  writeFileSync(join(outside, "manifest.json"), content);
  symlinkSync(outside, join(modules, "audit-probe"));
  const context = { cwd: tmpDir, scopeRoot: tmpDir };
  for (const action of ["info", "remove"]) {
    await expect(runModuleFactory({ action, name: "audit-probe" }, context)).rejects.toThrow("Unsafe filesystem path");
  }
  const result = await runModuleFactory({ action: "create", manifest: { name: "audit-probe" } }, context);
  expect(result.is_error).toBe(true);
  await expect(runModuleFactory({ action: "logs", name: "../../../outside" }, context)).rejects.toThrow("Invalid module name");
  expect(readFileSync(join(outside, "manifest.json"), "utf8")).toBe(content);
});
