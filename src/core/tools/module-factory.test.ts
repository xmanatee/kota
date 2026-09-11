import { existsSync, mkdirSync, rmSync, } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { manifestToModule } from "#core/manifest/index.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { ModuleLogStore } from "#core/modules/module-log.js";
import { clearCustomTools, getAllTools } from "./index.js";
import {
	runModuleFactory,
} from "./module-factory/index.js";

// Save/restore cwd since saveManifest uses cwd by default
let originalCwd: string;
let tmpDir: string;

beforeEach(() => {
	originalCwd = process.cwd();
	tmpDir = join(tmpdir(), `kota-moduletool-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tmpDir, { recursive: true });
	process.chdir(tmpDir);
});

afterEach(() => {
	process.chdir(originalCwd);
	clearCustomTools();
	try { rmSync(tmpDir, { recursive: true }); } catch { /* */ }
});

const sampleManifest = {
	name: "test-mod",
	version: "1.0.0",
	description: "A test module",
	tools: [{
		name: "test_tool",
		description: "A test tool",
		code: "print('hello')",
	}],
};

describe("runModuleFactory — create", () => {
  it("leaves activation and withdrawal to the module loader", async () => {
    const loader = new ModuleLoader({}, false, { mode: "runtime" });
    loader.setBus(new EventBus());
    await loader.load(manifestToModule(sampleManifest));
    try {
      const updated = { ...sampleManifest, tools: [{ ...sampleManifest.tools[0], name: "replacement_tool" }] };
      await runModuleFactory({ action: "create", manifest: updated });
      expect(getAllTools().some((tool) => tool.name === "test_tool")).toBe(true);
      expect(getAllTools().some((tool) => tool.name === "replacement_tool")).toBe(false);
      await runModuleFactory({ action: "remove", name: sampleManifest.name });
      expect(getAllTools().some((tool) => tool.name === "test_tool")).toBe(true);
    } finally {
      await loader.unloadAll();
    }
    expect(getAllTools().some((tool) => tool.name === "test_tool")).toBe(false);
  });

  it("keeps saved declarations within the caller's scope", async () => {
    const scopeA = { cwd: join(tmpDir, "scope-a"), sessionId: "a" };
    const scopeB = { cwd: join(tmpDir, "scope-b"), sessionId: "b" };
    mkdirSync(scopeA.cwd);
    mkdirSync(scopeB.cwd);
    expect((await runModuleFactory({ action: "create", manifest: sampleManifest }, scopeA)).is_error).toBeFalsy();
    expect((await runModuleFactory({ action: "list" }, scopeB)).content).not.toContain(sampleManifest.name);
    expect((await runModuleFactory({ action: "remove", name: sampleManifest.name }, scopeB)).is_error).toBe(true);
    expect(existsSync(join(scopeA.cwd, ".kota", "modules", sampleManifest.name, "manifest.json"))).toBe(true);
    expect(getAllTools().some((tool) => tool.name === "test_tool")).toBe(false);
  });

	it("saves a module declaration", async () => {
		const result = await runModuleFactory({ action: "create", manifest: sampleManifest });
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("test-mod");
		expect(result.content).toContain("test_tool");
	});

	it("persists the manifest to disk", async () => {
		await runModuleFactory({ action: "create", manifest: sampleManifest });
		const manifestPath = join(tmpDir, ".kota", "modules", "test-mod", "manifest.json");
		expect(existsSync(manifestPath)).toBe(true);
	});

	it("rejects missing manifest", async () => {
		const result = await runModuleFactory({ action: "create" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("manifest is required");
	});

	it("rejects invalid manifest", async () => {
		const result = await runModuleFactory({
			action: "create",
			manifest: { name: "X" },
		});
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("validation failed");
	});

	it("allows replacing an existing module", async () => {
		await runModuleFactory({ action: "create", manifest: sampleManifest });
		const updated = { ...sampleManifest, description: "Updated" };
		const result = await runModuleFactory({ action: "create", manifest: updated });
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("test-mod");
	});


});

describe("runModuleFactory — list", () => {
	it("returns empty message when no modules", async () => {
		const result = await runModuleFactory({ action: "list" });
		expect(result.content).toContain("No custom modules");
	});

	it("lists created modules", async () => {
		await runModuleFactory({ action: "create", manifest: sampleManifest });
		const result = await runModuleFactory({ action: "list" });
		expect(result.content).toContain("test-mod");
		expect(result.content).toContain("saved");
	});
});

describe("runModuleFactory — remove", () => {
	it("removes an existing module", async () => {
		await runModuleFactory({ action: "create", manifest: sampleManifest });
		const result = await runModuleFactory({ action: "remove", name: "test-mod" });
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("removed");
	});

	it("rejects missing name", async () => {
		const result = await runModuleFactory({ action: "remove" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("name is required");
	});

	it("rejects unknown module name", async () => {
		const result = await runModuleFactory({ action: "remove", name: "nope" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("no custom module");
	});

	it("cleans up manifest from disk", async () => {
		await runModuleFactory({ action: "create", manifest: sampleManifest });
		await runModuleFactory({ action: "remove", name: "test-mod" });
		const manifestPath = join(tmpDir, ".kota", "modules", "test-mod", "manifest.json");
		expect(existsSync(manifestPath)).toBe(false);
	});
});

describe("runModuleFactory — info", () => {
	it("shows details for an existing module", async () => {
		await runModuleFactory({ action: "create", manifest: sampleManifest });
		const result = await runModuleFactory({ action: "info", name: "test-mod" });
		expect(result.content).toContain("test-mod");
		expect(result.content).toContain("1.0.0");
		expect(result.content).toContain("test_tool");
	});

	it("rejects missing name", async () => {
		const result = await runModuleFactory({ action: "info" });
		expect(result.is_error).toBe(true);
	});

	it("rejects unknown module", async () => {
		const result = await runModuleFactory({ action: "info", name: "nope" });
		expect(result.is_error).toBe(true);
	});
});

describe("runModuleFactory — unknown action", () => {
	it("returns error for unknown action", async () => {
		const result = await runModuleFactory({ action: "bad" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("Unknown action");
	});
});


describe("runModuleFactory — logs", () => {
	it("returns error without authoritative scope", async () => {
		const result = await runModuleFactory({ action: "logs" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("authoritative scope");
	});

	it("returns summary of modules with logs when no name given", async () => {
		const store = new ModuleLogStore(tmpDir);
		store.append("mod-a", "info", "hello from a");
		store.append("mod-b", "error", "error from b");

		const result = await runModuleFactory({ action: "logs" }, { scopeRoot: tmpDir });
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("mod-a");
		expect(result.content).toContain("mod-b");
		expect(result.content).toContain("Modules with logs");
	});

	it("returns no logs message when store is empty", async () => {
		const result = await runModuleFactory({ action: "logs" }, { scopeRoot: tmpDir });
		expect(result.content).toContain("No module logs found");
	});

	it("returns log entries for a specific module", async () => {
		const store = new ModuleLogStore(tmpDir);
		store.append("my-mod", "info", "step 1 done");
		store.append("my-mod", "error", "step 2 failed");

		const result = await runModuleFactory({ action: "logs", name: "my-mod" }, { scopeRoot: tmpDir });
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("step 1 done");
		expect(result.content).toContain("step 2 failed");
		expect(result.content).toContain("2 entries");
	});

	it("filters by level", async () => {
		const store = new ModuleLogStore(tmpDir);
		store.append("my-mod", "info", "info msg");
		store.append("my-mod", "error", "error msg");

		const result = await runModuleFactory({ action: "logs", name: "my-mod", level: "error" }, { scopeRoot: tmpDir });
		expect(result.content).toContain("error msg");
		expect(result.content).not.toContain("info msg");
		expect(result.content).toContain("1 entries");
	});

	it("filters by keyword", async () => {
		const store = new ModuleLogStore(tmpDir);
		store.append("my-mod", "info", "weather check passed");
		store.append("my-mod", "info", "notification sent");

		const result = await runModuleFactory({ action: "logs", name: "my-mod", keyword: "weather" }, { scopeRoot: tmpDir });
		expect(result.content).toContain("weather");
		expect(result.content).not.toContain("notification");
	});

	it("respects limit parameter", async () => {
		const store = new ModuleLogStore(tmpDir);
		for (let i = 0; i < 10; i++) {
			store.append("my-mod", "info", `msg-${i}`);
		}

		const result = await runModuleFactory({ action: "logs", name: "my-mod", limit: 3 }, { scopeRoot: tmpDir });
		expect(result.content).toContain("3 entries");
	});

	it("shows empty message when module has no entries", async () => {
		const result = await runModuleFactory({ action: "logs", name: "no-logs-mod" }, { scopeRoot: tmpDir });
		expect(result.content).toContain("No log entries");
	});
});
