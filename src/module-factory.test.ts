import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	deleteManifest,
	discoverManifestModules,
	listManifestModules,
	loadManifest,
	type ModuleManifest,
	manifestToModule,
	saveManifest,
	validateManifest,
} from "./module-factory.js";

// ─── validateManifest ─────────────────────────────────────────────────

describe("validateManifest", () => {
	it("accepts a minimal valid manifest", () => {
		const errors = validateManifest({ name: "my-mod" });
		expect(errors).toHaveLength(0);
	});

	it("accepts a full manifest with tools", () => {
		const errors = validateManifest({
			name: "weather-mod",
			version: "1.0.0",
			description: "Weather tools",
			tools: [
				{
					name: "get_weather",
					description: "Get weather for a city",
					parameters: { type: "object", properties: { city: { type: "string" } } },
					code: "print('sunny')",
					language: "python",
				},
			],
			promptSection: "Use get_weather for weather data.",
		});
		expect(errors).toHaveLength(0);
	});

	it("rejects non-object input", () => {
		expect(validateManifest(null)).toHaveLength(1);
		expect(validateManifest("string")).toHaveLength(1);
		expect(validateManifest(42)).toHaveLength(1);
		expect(validateManifest([1, 2])).toHaveLength(1);
	});

	it("rejects missing name", () => {
		const errors = validateManifest({});
		expect(errors.some((e) => e.field === "name")).toBe(true);
	});

	it("rejects invalid name format", () => {
		expect(validateManifest({ name: "A" }).some((e) => e.field === "name")).toBe(true);
		expect(validateManifest({ name: "MY_MOD" }).some((e) => e.field === "name")).toBe(true);
		expect(validateManifest({ name: "a" }).some((e) => e.field === "name")).toBe(true); // too short
	});

	it("rejects builtin module names", () => {
		for (const name of ["memory", "secrets", "scheduler", "web", "telegram"]) {
			const errors = validateManifest({ name });
			expect(errors.some((e) => e.message.includes("built-in"))).toBe(true);
		}
	});

	it("rejects tools with missing required fields", () => {
		const errors = validateManifest({
			name: "test-mod",
			tools: [{ name: "foo" }],
		});
		expect(errors.some((e) => e.field.includes("description"))).toBe(true);
		expect(errors.some((e) => e.field.includes("code"))).toBe(true);
	});

	it("rejects tools with invalid parameter schema", () => {
		const errors = validateManifest({
			name: "test-mod",
			tools: [{
				name: "bad_params",
				description: "Bad",
				code: "print(1)",
				parameters: { type: "string" },
			}],
		});
		expect(errors.some((e) => e.message.includes("parameters.type"))).toBe(true);
	});

	it("rejects tools with builtin tool names", () => {
		const errors = validateManifest({
			name: "test-mod",
			tools: [{
				name: "shell",
				description: "Conflict",
				code: "print(1)",
			}],
		});
		expect(errors.some((e) => e.message.includes("built-in tool"))).toBe(true);
	});

	it("rejects duplicate tool names within a module", () => {
		const errors = validateManifest({
			name: "test-mod",
			tools: [
				{ name: "my_tool", description: "First", code: "print(1)" },
				{ name: "my_tool", description: "Second", code: "print(2)" },
			],
		});
		expect(errors.some((e) => e.message.includes("duplicate"))).toBe(true);
	});

	it("rejects invalid language", () => {
		const errors = validateManifest({
			name: "test-mod",
			tools: [{
				name: "bad_lang",
				description: "Bad",
				code: "print(1)",
				language: "ruby",
			}],
		});
		expect(errors.some((e) => e.message.includes("python"))).toBe(true);
	});

	it("rejects non-string promptSection", () => {
		const errors = validateManifest({
			name: "test-mod",
			promptSection: 42,
		});
		expect(errors.some((e) => e.field === "promptSection")).toBe(true);
	});

	it("rejects non-array dependencies", () => {
		const errors = validateManifest({
			name: "test-mod",
			dependencies: "not-array",
		});
		expect(errors.some((e) => e.field === "dependencies")).toBe(true);
	});
});

// ─── manifestToModule ─────────────────────────────────────────────────

describe("manifestToModule", () => {
	it("creates a KotaModule from a minimal manifest", () => {
		const mod = manifestToModule({ name: "simple" });
		expect(mod.name).toBe("simple");
		expect(mod.version).toBe("1.0.0");
		expect(mod.tools).toBeUndefined();
		expect(mod.promptSection).toBeUndefined();
	});

	it("creates a KotaModule with tools", () => {
		const mod = manifestToModule({
			name: "with-tools",
			tools: [{
				name: "say_hello",
				description: "Says hello",
				code: "print('hello')",
			}],
		});
		expect(mod.tools).toHaveLength(1);
		expect(mod.tools![0].tool.name).toBe("say_hello");
		expect(typeof mod.tools![0].runner).toBe("function");
	});

	it("creates a KotaModule with prompt section", () => {
		const mod = manifestToModule({
			name: "with-prompt",
			promptSection: "Use this module for testing.",
		});
		expect(mod.promptSection).toBeDefined();
		expect(mod.promptSection!({} as never)).toBe("Use this module for testing.");
	});

	it("preserves version and description", () => {
		const mod = manifestToModule({
			name: "meta-mod",
			version: "2.0.0",
			description: "A test module",
		});
		expect(mod.version).toBe("2.0.0");
		expect(mod.description).toBe("A test module");
	});

	it("sets default parameters schema when none provided", () => {
		const mod = manifestToModule({
			name: "no-params",
			tools: [{
				name: "no_param_tool",
				description: "No params",
				code: "print('ok')",
			}],
		});
		expect(mod.tools![0].tool.input_schema.type).toBe("object");
	});

	it("preserves tool group assignments", () => {
		const mod = manifestToModule({
			name: "grouped",
			tools: [{
				name: "grouped_tool",
				description: "Grouped",
				code: "print('ok')",
				group: "my-group",
			}],
		});
		expect(mod.tools![0].group).toBe("my-group");
	});
});

// ─── Persistence (save/load/delete/discover/list) ─────────────────────

describe("manifest persistence", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = join(tmpdir(), `kota-mf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tmpDir, { recursive: true });
	});

	afterEach(() => {
		try { rmSync(tmpDir, { recursive: true }); } catch { /* */ }
	});

	const sampleManifest: ModuleManifest = {
		name: "test-mod",
		version: "1.0.0",
		description: "A test module",
		tools: [{
			name: "test_tool",
			description: "A test tool",
			code: "print('test')",
		}],
		promptSection: "Use test_tool for testing.",
	};

	it("saveManifest creates manifest.json in the correct directory", () => {
		const path = saveManifest(sampleManifest, tmpDir);
		expect(existsSync(path)).toBe(true);
		const data = JSON.parse(readFileSync(path, "utf-8"));
		expect(data.name).toBe("test-mod");
		expect(data.tools).toHaveLength(1);
	});

	it("loadManifest reads a saved manifest", () => {
		saveManifest(sampleManifest, tmpDir);
		const loaded = loadManifest("test-mod", tmpDir);
		expect(loaded).not.toBeNull();
		expect(loaded!.name).toBe("test-mod");
		expect(loaded!.tools).toHaveLength(1);
	});

	it("loadManifest returns null for non-existent module", () => {
		expect(loadManifest("nonexistent", tmpDir)).toBeNull();
	});

	it("deleteManifest removes the manifest file", () => {
		saveManifest(sampleManifest, tmpDir);
		const deleted = deleteManifest("test-mod", tmpDir);
		expect(deleted).toBe(true);
		expect(loadManifest("test-mod", tmpDir)).toBeNull();
	});

	it("deleteManifest returns false for non-existent module", () => {
		expect(deleteManifest("nonexistent", tmpDir)).toBe(false);
	});

	it("deleteManifest preserves other files in module directory", () => {
		saveManifest(sampleManifest, tmpDir);
		// Simulate module storage file
		const storageFile = join(tmpDir, ".kota", "modules", "test-mod", "data.json");
		writeFileSync(storageFile, '{"key":"value"}');
		deleteManifest("test-mod", tmpDir);
		// data.json should still exist
		expect(existsSync(storageFile)).toBe(true);
	});

	it("discoverManifestModules finds saved modules", () => {
		saveManifest(sampleManifest, tmpDir);
		saveManifest({ ...sampleManifest, name: "other-mod", tools: [] }, tmpDir);
		const modules = discoverManifestModules(tmpDir);
		expect(modules).toHaveLength(2);
		const names = modules.map((m) => m.name).sort();
		expect(names).toEqual(["other-mod", "test-mod"]);
	});

	it("discoverManifestModules skips invalid manifests", () => {
		saveManifest(sampleManifest, tmpDir);
		// Write an invalid manifest
		const badDir = join(tmpDir, ".kota", "modules", "bad-mod");
		mkdirSync(badDir, { recursive: true });
		writeFileSync(join(badDir, "manifest.json"), "not json");
		const modules = discoverManifestModules(tmpDir);
		expect(modules).toHaveLength(1);
	});

	it("discoverManifestModules returns empty for non-existent directory", () => {
		const modules = discoverManifestModules(join(tmpDir, "nonexistent"));
		expect(modules).toHaveLength(0);
	});

	it("listManifestModules returns name and manifest pairs", () => {
		saveManifest(sampleManifest, tmpDir);
		const list = listManifestModules(tmpDir);
		expect(list).toHaveLength(1);
		expect(list[0].name).toBe("test-mod");
		expect(list[0].manifest.description).toBe("A test module");
	});
});
