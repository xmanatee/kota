import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
	runModuleScript,
	saveManifest,
	validateManifest,
} from "./module-factory.js";
import type { KotaModule, ToolDef } from "./module-types.js";

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

	// ─── eventHandlers validation ──────────────────────────────────────

	it("accepts valid eventHandlers", () => {
		const errors = validateManifest({
			name: "event-mod",
			eventHandlers: [
				{ event: "schedule.fire", code: "print('fired')" },
				{ event: "custom.event", code: "console.log('ok')", language: "node" },
			],
		});
		expect(errors).toHaveLength(0);
	});

	it("rejects non-array eventHandlers", () => {
		const errors = validateManifest({
			name: "event-mod",
			eventHandlers: "not-array",
		});
		expect(errors.some((e) => e.field === "eventHandlers")).toBe(true);
	});

	it("rejects event handler missing event name", () => {
		const errors = validateManifest({
			name: "event-mod",
			eventHandlers: [{ code: "print(1)" }],
		});
		expect(errors.some((e) => e.field === "eventHandlers[0].event")).toBe(true);
	});

	it("rejects event handler missing both code and steps", () => {
		const errors = validateManifest({
			name: "event-mod",
			eventHandlers: [{ event: "test.event" }],
		});
		expect(errors.some((e) => e.message.includes("either code or steps"))).toBe(true);
	});

	it("rejects event handler with both code and steps", () => {
		const errors = validateManifest({
			name: "event-mod",
			eventHandlers: [{
				event: "test.event",
				code: "print(1)",
				steps: [{ tool: "shell", input: { command: "echo hi" } }],
			}],
		});
		expect(errors.some((e) => e.message.includes("cannot have both"))).toBe(true);
	});

	it("accepts valid step-based event handlers", () => {
		const errors = validateManifest({
			name: "step-mod",
			eventHandlers: [{
				event: "schedule.fire",
				steps: [
					{ tool: "web_fetch", input: { url: "https://example.com" } },
					{ tool: "knowledge", input: { action: "create", title: "Fetched", content: "$prev" } },
				],
			}],
		});
		expect(errors).toHaveLength(0);
	});

	it("rejects steps with missing tool name", () => {
		const errors = validateManifest({
			name: "step-mod",
			eventHandlers: [{
				event: "test.event",
				steps: [{ input: { foo: "bar" } }],
			}],
		});
		expect(errors.some((e) => e.field.includes("steps[0].tool"))).toBe(true);
	});

	it("rejects steps with invalid input type", () => {
		const errors = validateManifest({
			name: "step-mod",
			eventHandlers: [{
				event: "test.event",
				steps: [{ tool: "shell", input: "not-object" }],
			}],
		});
		expect(errors.some((e) => e.field.includes("steps[0].input"))).toBe(true);
	});

	it("rejects non-object step entries", () => {
		const errors = validateManifest({
			name: "step-mod",
			eventHandlers: [{
				event: "test.event",
				steps: ["not-an-object"],
			}],
		});
		expect(errors.some((e) => e.field.includes("steps[0]"))).toBe(true);
	});

	it("accepts steps with string if field", () => {
		const errors = validateManifest({
			name: "cond-mod",
			eventHandlers: [{
				event: "test.event",
				steps: [{ tool: "shell", if: "$prev.status == ok" }],
			}],
		});
		expect(errors).toHaveLength(0);
	});

	it("rejects steps with non-string if field", () => {
		const errors = validateManifest({
			name: "cond-mod",
			eventHandlers: [{
				event: "test.event",
				steps: [{ tool: "shell", if: 42 }],
			}],
		});
		expect(errors.some((e) => e.field.includes("if"))).toBe(true);
	});

	it("accepts steps without input (no-arg tool call)", () => {
		const errors = validateManifest({
			name: "step-mod",
			eventHandlers: [{
				event: "test.event",
				steps: [{ tool: "screenshot" }],
			}],
		});
		expect(errors).toHaveLength(0);
	});

	it("rejects event handler with invalid language", () => {
		const errors = validateManifest({
			name: "event-mod",
			eventHandlers: [{ event: "test.event", code: "print(1)", language: "ruby" }],
		});
		expect(errors.some((e) => e.field === "eventHandlers[0].language")).toBe(true);
	});

	it("rejects non-object event handler entries", () => {
		const errors = validateManifest({
			name: "event-mod",
			eventHandlers: ["not-an-object"],
		});
		expect(errors.some((e) => e.field === "eventHandlers[0]")).toBe(true);
	});

	// ─── scripts validation ───────────────────────────────────────────

	it("accepts valid scripts", () => {
		const errors = validateManifest({
			name: "script-mod",
			scripts: {
				"daily-check": {
					description: "Run a daily check",
					steps: [{ tool: "shell", input: { command: "echo hello" } }],
				},
			},
		});
		expect(errors).toHaveLength(0);
	});

	it("accepts scripts without description", () => {
		const errors = validateManifest({
			name: "script-mod",
			scripts: {
				run: { steps: [{ tool: "shell" }] },
			},
		});
		expect(errors).toHaveLength(0);
	});

	it("rejects non-object scripts", () => {
		const errors = validateManifest({
			name: "script-mod",
			scripts: "not-object",
		});
		expect(errors.some((e) => e.field === "scripts")).toBe(true);
	});

	it("rejects scripts with invalid name format", () => {
		const errors = validateManifest({
			name: "script-mod",
			scripts: { "A": { steps: [{ tool: "shell" }] } },
		});
		expect(errors.some((e) => e.field === "scripts.A")).toBe(true);
	});

	it("rejects script with empty steps", () => {
		const errors = validateManifest({
			name: "script-mod",
			scripts: { "empty-script": { steps: [] } },
		});
		expect(errors.some((e) => e.field === "scripts.empty-script.steps")).toBe(true);
	});

	it("rejects script with missing steps", () => {
		const errors = validateManifest({
			name: "script-mod",
			scripts: { "no-steps": {} },
		});
		expect(errors.some((e) => e.field === "scripts.no-steps.steps")).toBe(true);
	});

	it("rejects script step with missing tool", () => {
		const errors = validateManifest({
			name: "script-mod",
			scripts: { "bad-step": { steps: [{ input: { foo: "bar" } }] } },
		});
		expect(errors.some((e) => e.field.includes("steps[0].tool"))).toBe(true);
	});

	it("rejects script step with invalid input type", () => {
		const errors = validateManifest({
			name: "script-mod",
			scripts: { "bad-input": { steps: [{ tool: "shell", input: "not-obj" }] } },
		});
		expect(errors.some((e) => e.field.includes("steps[0].input"))).toBe(true);
	});

	it("rejects non-object script entry", () => {
		const errors = validateManifest({
			name: "script-mod",
			scripts: { "bad-entry": "not-object" },
		});
		expect(errors.some((e) => e.field === "scripts.bad-entry")).toBe(true);
	});

	it("accepts script steps with if conditions", () => {
		const errors = validateManifest({
			name: "cond-script",
			scripts: {
				"check-and-notify": {
					steps: [
						{ tool: "shell", input: { command: "echo ok" } },
						{ tool: "notify", input: { message: "done" }, if: "$prev == ok" },
					],
				},
			},
		});
		expect(errors).toHaveLength(0);
	});

	it("rejects script steps with non-string if", () => {
		const errors = validateManifest({
			name: "cond-script",
			scripts: {
				"bad-if": {
					steps: [{ tool: "shell", if: true }],
				},
			},
		});
		expect(errors.some((e) => e.field.includes("if"))).toBe(true);
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
		expect(toolsOf(mod)).toHaveLength(1);
		expect(toolsOf(mod)[0].tool.name).toBe("say_hello");
		expect(typeof toolsOf(mod)[0].runner).toBe("function");
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

	it("creates events function from eventHandlers", () => {
		const mod = manifestToModule({
			name: "evented",
			eventHandlers: [
				{ event: "test.ping", code: "print('pong')" },
			],
		});
		expect(mod.events).toBeDefined();
		expect(typeof mod.events).toBe("function");
	});

	it("events function returns unsubscribe functions", () => {
		const mod = manifestToModule({
			name: "evented",
			eventHandlers: [
				{ event: "test.ping", code: "print('pong')" },
				{ event: "test.pong", code: "print('ping')" },
			],
		});

		// Create a minimal mock bus
		const handlers = new Map<string, Set<(p: Record<string, unknown>) => void>>();
		const mockBus = {
			on: (event: string, handler: (p: Record<string, unknown>) => void) => {
				let set = handlers.get(event);
				if (!set) { set = new Set(); handlers.set(event, set); }
				set.add(handler);
				return () => { set!.delete(handler); };
			},
		};

		const unsubs = mod.events!(mockBus as never);
		expect(unsubs).toHaveLength(2);
		expect(handlers.get("test.ping")?.size).toBe(1);
		expect(handlers.get("test.pong")?.size).toBe(1);

		// Unsubscribe all
		for (const unsub of unsubs) unsub();
		expect(handlers.get("test.ping")?.size).toBe(0);
		expect(handlers.get("test.pong")?.size).toBe(0);
	});

	it("module without eventHandlers has no events function", () => {
		const mod = manifestToModule({ name: "no-events" });
		expect(mod.events).toBeUndefined();
	});

	it("empty eventHandlers array produces no events function", () => {
		const mod = manifestToModule({ name: "empty-events", eventHandlers: [] });
		expect(mod.events).toBeUndefined();
	});

	it("creates events function from step-based handlers", () => {
		const mod = manifestToModule({
			name: "step-evented",
			eventHandlers: [{
				event: "schedule.fire",
				steps: [{ tool: "shell", input: { command: "echo hello" } }],
			}],
		});
		expect(mod.events).toBeDefined();
		expect(typeof mod.events).toBe("function");
	});

	it("step-based events function returns unsubscribe functions", () => {
		const mod = manifestToModule({
			name: "step-evented",
			eventHandlers: [{
				event: "schedule.fire",
				steps: [{ tool: "shell", input: { command: "echo hello" } }],
			}],
		});

		const handlers = new Map<string, Set<(p: Record<string, unknown>) => void>>();
		const mockBus = {
			on: (event: string, handler: (p: Record<string, unknown>) => void) => {
				let set = handlers.get(event);
				if (!set) { set = new Set(); handlers.set(event, set); }
				set.add(handler);
				return () => { set!.delete(handler); };
			},
		};

		const unsubs = mod.events!(mockBus as never);
		expect(unsubs).toHaveLength(1);
		expect(handlers.get("schedule.fire")?.size).toBe(1);

		for (const unsub of unsubs) unsub();
		expect(handlers.get("schedule.fire")?.size).toBe(0);
	});

	it("handles mixed code and step handlers", () => {
		const mod = manifestToModule({
			name: "mixed-mod",
			eventHandlers: [
				{ event: "code.event", code: "print('hello')" },
				{ event: "step.event", steps: [{ tool: "shell" }] },
			],
		});

		const handlers = new Map<string, Set<(p: Record<string, unknown>) => void>>();
		const mockBus = {
			on: (event: string, handler: (p: Record<string, unknown>) => void) => {
				let set = handlers.get(event);
				if (!set) { set = new Set(); handlers.set(event, set); }
				set.add(handler);
				return () => { set!.delete(handler); };
			},
		};

		const unsubs = mod.events!(mockBus as never);
		expect(unsubs).toHaveLength(2);
		expect(handlers.get("code.event")?.size).toBe(1);
		expect(handlers.get("step.event")?.size).toBe(1);
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

// ─── runModuleScript ──────────────────────────────────────────────────

import { executeTool } from "./tools/index.js";

vi.mock("./tools/index.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./tools/index.js")>();
	return { ...actual, executeTool: vi.fn() };
});

const mockExecute = vi.mocked(executeTool);

describe("runModuleScript", () => {
	beforeEach(() => {
		mockExecute.mockReset();
	});

	it("executes steps sequentially and returns final result", async () => {
		mockExecute
			.mockResolvedValueOnce({ content: "step1-output" })
			.mockResolvedValueOnce({ content: "final-output" });

		const result = await runModuleScript("test-mod", {
			steps: [
				{ tool: "shell", input: { command: "echo hello" } },
				{ tool: "notify", input: { message: "$prev" } },
			],
		});

		expect(result.is_error).toBeUndefined();
		expect(result.content).toBe("final-output");
		expect(mockExecute).toHaveBeenCalledTimes(2);
		// Second step should receive $prev resolved to first step's output
		expect(mockExecute).toHaveBeenNthCalledWith(2, "notify", { message: "step1-output" });
	});

	it("stops on first error and reports which step failed", async () => {
		mockExecute
			.mockResolvedValueOnce({ content: "ok" })
			.mockResolvedValueOnce({ content: "bad thing happened", is_error: true });

		const result = await runModuleScript("test-mod", {
			steps: [
				{ tool: "shell", input: { command: "echo ok" } },
				{ tool: "shell", input: { command: "bad-cmd" } },
				{ tool: "notify", input: { message: "$prev" } },
			],
		});

		expect(result.is_error).toBe(true);
		expect(result.content).toContain("Step 2/3");
		expect(result.content).toContain("bad thing happened");
		expect(mockExecute).toHaveBeenCalledTimes(2); // 3rd step never reached
	});

	it("handles tool execution errors (throws)", async () => {
		mockExecute.mockRejectedValueOnce(new Error("connection refused"));

		const result = await runModuleScript("test-mod", {
			steps: [{ tool: "http_request", input: { url: "http://down" } }],
		});

		expect(result.is_error).toBe(true);
		expect(result.content).toContain("connection refused");
		expect(result.content).toContain("Step 1/1");
	});

	it("returns error for empty steps", async () => {
		const result = await runModuleScript("test-mod", { steps: [] });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("no steps");
	});

	it("passes args as payload for $payload substitution", async () => {
		mockExecute.mockResolvedValueOnce({ content: "done" });

		await runModuleScript(
			"test-mod",
			{ steps: [{ tool: "shell", input: { command: "$payload" } }] },
			{ topic: "AI", count: 5 },
		);

		expect(mockExecute).toHaveBeenCalledWith("shell", {
			command: JSON.stringify({ topic: "AI", count: 5 }),
		});
	});

	it("single step returns its output directly", async () => {
		mockExecute.mockResolvedValueOnce({ content: "hello world" });

		const result = await runModuleScript("test-mod", {
			steps: [{ tool: "shell", input: { command: "echo hello world" } }],
		});

		expect(result.content).toBe("hello world");
	});

	it("supports $steps[N] to reference earlier step outputs", async () => {
		mockExecute
			.mockResolvedValueOnce({ content: "first" })
			.mockResolvedValueOnce({ content: "second" })
			.mockResolvedValueOnce({ content: "done" });

		await runModuleScript("test-mod", {
			steps: [
				{ tool: "shell", input: { command: "echo first" } },
				{ tool: "shell", input: { command: "echo second" } },
				{ tool: "notify", input: { message: "$steps[0]" } },
			],
		});

		expect(mockExecute).toHaveBeenNthCalledWith(3, "notify", { message: "first" });
	});

	it("supports $steps[N].field for JSON field extraction", async () => {
		mockExecute
			.mockResolvedValueOnce({ content: '{"url":"https://example.com","title":"Test"}' })
			.mockResolvedValueOnce({ content: "done" });

		await runModuleScript("test-mod", {
			steps: [
				{ tool: "http_request", input: { url: "https://api.example.com" } },
				{ tool: "web_fetch", input: { url: "$steps[0].url" } },
			],
		});

		expect(mockExecute).toHaveBeenNthCalledWith(2, "web_fetch", { url: "https://example.com" });
	});

	it("supports $prev.field for JSON field extraction from previous step", async () => {
		mockExecute
			.mockResolvedValueOnce({ content: '{"name":"Alice","age":30}' })
			.mockResolvedValueOnce({ content: "done" });

		await runModuleScript("test-mod", {
			steps: [
				{ tool: "shell", input: { command: "echo json" } },
				{ tool: "notify", input: { message: "$prev.name" } },
			],
		});

		expect(mockExecute).toHaveBeenNthCalledWith(2, "notify", { message: "Alice" });
	});

	it("supports $payload.field for payload field extraction", async () => {
		mockExecute.mockResolvedValueOnce({ content: "done" });

		await runModuleScript(
			"test-mod",
			{ steps: [{ tool: "web_fetch", input: { url: "$payload.target_url" } }] },
			{ target_url: "https://example.com", format: "json" },
		);

		expect(mockExecute).toHaveBeenCalledWith("web_fetch", { url: "https://example.com" });
	});

	it("supports template interpolation with {{ref}}", async () => {
		mockExecute
			.mockResolvedValueOnce({ content: '{"city":"Tokyo","temp":25}' })
			.mockResolvedValueOnce({ content: "done" });

		await runModuleScript(
			"test-mod",
			{
				steps: [
					{ tool: "http_request", input: { url: "https://weather.api" } },
					{ tool: "notify", input: { message: "Weather in {{$prev.city}}: {{$prev.temp}}°C" } },
				],
			},
		);

		expect(mockExecute).toHaveBeenNthCalledWith(2, "notify", {
			message: "Weather in Tokyo: 25°C",
		});
	});

	it("template interpolation with $steps[N] references", async () => {
		mockExecute
			.mockResolvedValueOnce({ content: '{"name":"Report"}' })
			.mockResolvedValueOnce({ content: '{"status":"complete"}' })
			.mockResolvedValueOnce({ content: "done" });

		await runModuleScript("test-mod", {
			steps: [
				{ tool: "shell", input: { command: "echo name" } },
				{ tool: "shell", input: { command: "echo status" } },
				{ tool: "notify", input: { message: "{{$steps[0].name}} is {{$steps[1].status}}" } },
			],
		});

		expect(mockExecute).toHaveBeenNthCalledWith(3, "notify", {
			message: "Report is complete",
		});
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

// ─── runModuleScript with conditional steps ──────────────────────────

describe("runModuleScript conditional steps", () => {
	beforeEach(() => {
		mockExecute.mockReset();
	});

	it("skips step when if condition is false", async () => {
		mockExecute
			.mockResolvedValueOnce({ content: '{"status":"error"}' })
			.mockResolvedValueOnce({ content: "fallback-done" });

		const result = await runModuleScript("test-mod", {
			steps: [
				{ tool: "web_fetch", input: { url: "https://api.test" } },
				{ tool: "notify", input: { message: "success" }, if: "$prev.status == ok" },
				{ tool: "notify", input: { message: "fallback" }, if: "$prev.status == error" },
			],
		});

		expect(result.content).toBe("fallback-done");
		expect(mockExecute).toHaveBeenCalledTimes(2);
		// Step 2 (notify success) was skipped; step 3 executed
		expect(mockExecute).toHaveBeenNthCalledWith(2, "notify", { message: "fallback" });
	});

	it("executes step when if condition is true", async () => {
		mockExecute
			.mockResolvedValueOnce({ content: '{"count":5}' })
			.mockResolvedValueOnce({ content: "notified" });

		const result = await runModuleScript("test-mod", {
			steps: [
				{ tool: "shell", input: { command: "echo json" } },
				{ tool: "notify", input: { message: "items found" }, if: "$prev.count > 0" },
			],
		});

		expect(result.content).toBe("notified");
		expect(mockExecute).toHaveBeenCalledTimes(2);
	});

	it("skipped step produces empty $steps[N] output", async () => {
		mockExecute
			.mockResolvedValueOnce({ content: "first" })
			.mockResolvedValueOnce({ content: "third" });

		await runModuleScript("test-mod", {
			steps: [
				{ tool: "shell", input: { command: "echo first" } },
				{ tool: "shell", input: { command: "skipped" }, if: "$prev == nope" },
				{ tool: "notify", input: { message: "$steps[1]" } },
			],
		});

		// Step 2 was skipped, so $steps[1] is ""
		expect(mockExecute).toHaveBeenNthCalledWith(2, "notify", { message: "" });
	});

	it("skipped step does not update $prev", async () => {
		mockExecute
			.mockResolvedValueOnce({ content: "original" })
			.mockResolvedValueOnce({ content: "done" });

		await runModuleScript("test-mod", {
			steps: [
				{ tool: "shell", input: { command: "echo original" } },
				{ tool: "shell", input: { command: "skipped" }, if: "$prev == nope" },
				{ tool: "notify", input: { message: "$prev" } },
			],
		});

		// $prev should still be "original" since step 2 was skipped
		expect(mockExecute).toHaveBeenNthCalledWith(2, "notify", { message: "original" });
	});

	it("steps without if always execute", async () => {
		mockExecute
			.mockResolvedValueOnce({ content: "a" })
			.mockResolvedValueOnce({ content: "b" });

		const result = await runModuleScript("test-mod", {
			steps: [
				{ tool: "shell", input: { command: "echo a" } },
				{ tool: "shell", input: { command: "echo b" } },
			],
		});

		expect(result.content).toBe("b");
		expect(mockExecute).toHaveBeenCalledTimes(2);
	});

	it("all steps skipped returns last prevContent", async () => {
		const result = await runModuleScript("test-mod", {
			steps: [
				{ tool: "shell", if: "$prev == never" },
			],
		});

		// $prev starts as "" which doesn't match, step skipped, returns ""
		expect(result.content).toBe("");
		expect(mockExecute).not.toHaveBeenCalled();
	});
});
