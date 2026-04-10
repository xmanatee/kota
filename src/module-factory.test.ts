import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KotaModule, ToolDef } from "./core/modules/module-types.js";
import {
	deleteManifest,
	discoverManifestModules,
	evaluateCondition,
	getFieldByPath,
	listManifestModules,
	loadManifest,
	type ModuleManifest,
	manifestToModule,
	resolveRef,
	resolveStepInput,
	saveManifest,
	validateManifest,
} from "./manifest/index.js";

/** Helper to get tools as array from a KotaModule. */
function toolsOf(mod: KotaModule): ToolDef[] {
  return Array.isArray(mod.tools) ? mod.tools : [];
}

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

	it("rejects reserved module names", () => {
		for (const name of ["memory", "secrets", "scheduler", "web", "telegram"]) {
			const errors = validateManifest({ name });
			expect(errors.some((e) => e.message.includes("project module"))).toBe(true);
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

	it("rejects tools with reserved project tool names", () => {
		const errors = validateManifest({
			name: "test-mod",
			tools: [{
				name: "shell",
				description: "Conflict",
				code: "print(1)",
			}],
		});
		expect(errors.some((e) => e.message.includes("project tool"))).toBe(true);
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
		expect(toolsOf(mod)).toHaveLength(1);
		expect(toolsOf(mod)[0].tool.name).toBe("say_hello");
		expect(typeof toolsOf(mod)[0].runner).toBe("function");
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
		expect(toolsOf(mod)[0].tool.input_schema.type).toBe("object");
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
		expect(toolsOf(mod)[0].group).toBe("my-group");
	});

});

// ─── resolveStepInput ──────────────────────────────────────────────────

describe("resolveStepInput", () => {
	it("replaces $prev with previous step content", () => {
		const result = resolveStepInput(
			{ content: "$prev", title: "Fixed title" },
			"previous output",
			{},
		);
		expect(result.content).toBe("previous output");
		expect(result.title).toBe("Fixed title");
	});

	it("replaces $payload with serialized payload", () => {
		const payload = { url: "https://example.com", count: 5 };
		const result = resolveStepInput(
			{ data: "$payload" },
			"",
			payload,
		);
		expect(result.data).toBe(JSON.stringify(payload));
	});

	it("passes through non-string and non-special values", () => {
		const result = resolveStepInput(
			{ count: 42, flag: true, text: "normal", nested: { a: 1 } },
			"prev",
			{},
		);
		expect(result.count).toBe(42);
		expect(result.flag).toBe(true);
		expect(result.text).toBe("normal");
		expect(result.nested).toEqual({ a: 1 });
	});

	it("returns empty object when input is undefined", () => {
		expect(resolveStepInput(undefined, "prev", {})).toEqual({});
	});

	it("handles $prev as empty string for first step", () => {
		const result = resolveStepInput({ content: "$prev" }, "", {});
		expect(result.content).toBe("");
	});

	it("resolves $steps[N] with allOutputs", () => {
		const result = resolveStepInput(
			{ first: "$steps[0]", second: "$steps[1]" },
			"current",
			{},
			["step-0-out", "step-1-out"],
		);
		expect(result.first).toBe("step-0-out");
		expect(result.second).toBe("step-1-out");
	});

	it("resolves $prev.field from JSON output", () => {
		const result = resolveStepInput(
			{ name: "$prev.user.name" },
			'{"user":{"name":"Bob"}}',
			{},
		);
		expect(result.name).toBe("Bob");
	});

	it("resolves $payload.field directly from payload object", () => {
		const result = resolveStepInput(
			{ url: "$payload.endpoint" },
			"",
			{ endpoint: "https://api.test", key: "abc" },
		);
		expect(result.url).toBe("https://api.test");
	});

	it("resolves template strings with {{ref}} markers", () => {
		const result = resolveStepInput(
			{ msg: "Hello {{$prev.name}}, you have {{$payload.count}} items" },
			'{"name":"Alice"}',
			{ count: 5 },
		);
		expect(result.msg).toBe("Hello Alice, you have 5 items");
	});

	it("leaves unrecognized {{ref}} markers unchanged", () => {
		const result = resolveStepInput(
			{ msg: "Value: {{$unknown}}" },
			"prev",
			{},
		);
		expect(result.msg).toBe("Value: {{$unknown}}");
	});

	it("handles undefined field access gracefully in templates", () => {
		const result = resolveStepInput(
			{ msg: "Value: {{$prev.missing}}" },
			'{"name":"test"}',
			{},
		);
		expect(result.msg).toBe("Value: ");
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

// ─── getFieldByPath ──────────────────────────────────────────────────

describe("getFieldByPath", () => {
	it("traverses nested objects", () => {
		expect(getFieldByPath({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
	});

	it("returns undefined for missing paths", () => {
		expect(getFieldByPath({ a: 1 }, "b.c")).toBeUndefined();
	});

	it("handles null/undefined in chain", () => {
		expect(getFieldByPath({ a: null }, "a.b")).toBeUndefined();
	});

	it("returns top-level values", () => {
		expect(getFieldByPath({ name: "test" }, "name")).toBe("test");
	});

	it("handles non-object input", () => {
		expect(getFieldByPath("string", "length")).toBeUndefined();
	});
});

// ─── resolveRef ──────────────────────────────────────────────────────

describe("resolveRef", () => {
	const outputs = ["step0-out", '{"key":"val"}', "step2-out"];
	const payload = { id: 123, nested: { x: "y" } };

	it("resolves $prev", () => {
		const r = resolveRef("$prev", "prev-content", payload, outputs);
		expect(r).toEqual({ hit: true, value: "prev-content" });
	});

	it("resolves $prev.field from JSON", () => {
		const r = resolveRef("$prev.key", '{"key":"val"}', {}, []);
		expect(r).toEqual({ hit: true, value: "val" });
	});

	it("resolves $steps[N]", () => {
		const r = resolveRef("$steps[1]", "", {}, outputs);
		expect(r).toEqual({ hit: true, value: '{"key":"val"}' });
	});

	it("resolves $steps[N].field", () => {
		const r = resolveRef("$steps[1].key", "", {}, outputs);
		expect(r).toEqual({ hit: true, value: "val" });
	});

	it("resolves $payload", () => {
		const r = resolveRef("$payload", "", payload, []);
		expect(r).toEqual({ hit: true, value: JSON.stringify(payload) });
	});

	it("resolves $payload.field", () => {
		const r = resolveRef("$payload.id", "", payload, []);
		expect(r).toEqual({ hit: true, value: 123 });
	});

	it("resolves $payload.nested.field", () => {
		const r = resolveRef("$payload.nested.x", "", payload, []);
		expect(r).toEqual({ hit: true, value: "y" });
	});

	it("returns hit:false for non-references", () => {
		const r = resolveRef("normal string", "", {}, []);
		expect(r).toEqual({ hit: false });
	});

	it("handles out-of-bounds $steps[N]", () => {
		const r = resolveRef("$steps[99]", "", {}, ["only-one"]);
		expect(r).toEqual({ hit: true, value: "" });
	});
});

// ─── evaluateCondition ───────────────────────────────────────────────

describe("evaluateCondition", () => {
	it("returns true for empty expression", () => {
		expect(evaluateCondition("", "", {}, [])).toBe(true);
		expect(evaluateCondition("  ", "", {}, [])).toBe(true);
	});

	it("bare $prev — truthy when non-empty", () => {
		expect(evaluateCondition("$prev", "hello", {}, [])).toBe(true);
	});

	it("bare $prev — falsy when empty", () => {
		expect(evaluateCondition("$prev", "", {}, [])).toBe(false);
	});

	it("bare $prev.field — truthy when field exists", () => {
		expect(evaluateCondition("$prev.name", '{"name":"Alice"}', {}, [])).toBe(true);
	});

	it("bare $prev.field — falsy when field missing", () => {
		expect(evaluateCondition("$prev.missing", '{"name":"Alice"}', {}, [])).toBe(false);
	});

	it("== comparison with string values", () => {
		expect(evaluateCondition("$prev.status == ok", '{"status":"ok"}', {}, [])).toBe(true);
		expect(evaluateCondition("$prev.status == fail", '{"status":"ok"}', {}, [])).toBe(false);
	});

	it("!= comparison", () => {
		expect(evaluateCondition("$prev.status != error", '{"status":"ok"}', {}, [])).toBe(true);
		expect(evaluateCondition("$prev.status != ok", '{"status":"ok"}', {}, [])).toBe(false);
	});

	it("> comparison with numeric values", () => {
		expect(evaluateCondition("$prev.count > 0", '{"count":5}', {}, [])).toBe(true);
		expect(evaluateCondition("$prev.count > 10", '{"count":5}', {}, [])).toBe(false);
	});

	it("< comparison", () => {
		expect(evaluateCondition("$prev.count < 10", '{"count":5}', {}, [])).toBe(true);
		expect(evaluateCondition("$prev.count < 3", '{"count":5}', {}, [])).toBe(false);
	});

	it(">= and <= comparisons", () => {
		expect(evaluateCondition("$prev.count >= 5", '{"count":5}', {}, [])).toBe(true);
		expect(evaluateCondition("$prev.count <= 5", '{"count":5}', {}, [])).toBe(true);
		expect(evaluateCondition("$prev.count >= 6", '{"count":5}', {}, [])).toBe(false);
	});

	it("$steps[N] reference in condition", () => {
		expect(evaluateCondition("$steps[0].ok == true", "", {}, ['{"ok":"true"}'])).toBe(true);
	});

	it("$payload reference in condition", () => {
		expect(evaluateCondition("$payload.mode == fast", "", { mode: "fast" }, [])).toBe(true);
	});

	it("falsy values: 'false', '0', null, undefined", () => {
		expect(evaluateCondition("$prev", "false", {}, [])).toBe(false);
		expect(evaluateCondition("$prev", "0", {}, [])).toBe(false);
		expect(evaluateCondition("$prev.x", '{"y":1}', {}, [])).toBe(false);
	});
});
