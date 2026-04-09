import { existsSync, mkdirSync, rmSync, } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initModuleLogStore, resetModuleLogStore } from "../module-log.js";
import {
	getLoadedManifestModuleCount,
	markModuleLoaded,
	resetModuleFactory,
	runModuleFactory,
} from "./module-factory/index.js";
import { clearCustomTools } from "./index.js";

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
	resetModuleFactory();
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
	it("creates a module and registers its tools", async () => {
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

	it("rejects when max modules reached", async () => {
		// Create 10 modules to hit the limit
		for (let i = 0; i < 10; i++) {
			await runModuleFactory({
				action: "create",
				manifest: { name: `mod-${String(i).padStart(2, "0")}`, tools: [] },
			});
		}
		const result = await runModuleFactory({
			action: "create",
			manifest: { name: "one-too-many", tools: [] },
		});
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("maximum");
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
		expect(result.content).toContain("active");
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


describe("session lifecycle", () => {
	it("markModuleLoaded tracks loaded modules", () => {
		expect(getLoadedManifestModuleCount()).toBe(0);
		markModuleLoaded("my-mod");
		expect(getLoadedManifestModuleCount()).toBe(1);
	});

	it("resetModuleFactory clears state", () => {
		markModuleLoaded("my-mod");
		resetModuleFactory();
		expect(getLoadedManifestModuleCount()).toBe(0);
	});
});

describe("runModuleFactory — logs", () => {
	it("returns error when log store not initialized", async () => {
		resetModuleLogStore();
		const result = await runModuleFactory({ action: "logs" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("not initialized");
	});

	it("returns summary of modules with logs when no name given", async () => {
		initModuleLogStore(tmpDir);
		const store = initModuleLogStore(tmpDir);
		store.append("mod-a", "info", "hello from a");
		store.append("mod-b", "error", "error from b");

		const result = await runModuleFactory({ action: "logs" });
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("mod-a");
		expect(result.content).toContain("mod-b");
		expect(result.content).toContain("Modules with logs");
		resetModuleLogStore();
	});

	it("returns no logs message when store is empty", async () => {
		initModuleLogStore(tmpDir);
		const result = await runModuleFactory({ action: "logs" });
		expect(result.content).toContain("No module logs found");
		resetModuleLogStore();
	});

	it("returns log entries for a specific module", async () => {
		const store = initModuleLogStore(tmpDir);
		store.append("my-mod", "info", "step 1 done");
		store.append("my-mod", "error", "step 2 failed");

		const result = await runModuleFactory({ action: "logs", name: "my-mod" });
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("step 1 done");
		expect(result.content).toContain("step 2 failed");
		expect(result.content).toContain("2 entries");
		resetModuleLogStore();
	});

	it("filters by level", async () => {
		const store = initModuleLogStore(tmpDir);
		store.append("my-mod", "info", "info msg");
		store.append("my-mod", "error", "error msg");

		const result = await runModuleFactory({ action: "logs", name: "my-mod", level: "error" });
		expect(result.content).toContain("error msg");
		expect(result.content).not.toContain("info msg");
		expect(result.content).toContain("1 entries");
		resetModuleLogStore();
	});

	it("filters by keyword", async () => {
		const store = initModuleLogStore(tmpDir);
		store.append("my-mod", "info", "weather check passed");
		store.append("my-mod", "info", "notification sent");

		const result = await runModuleFactory({ action: "logs", name: "my-mod", keyword: "weather" });
		expect(result.content).toContain("weather");
		expect(result.content).not.toContain("notification");
		resetModuleLogStore();
	});

	it("respects limit parameter", async () => {
		const store = initModuleLogStore(tmpDir);
		for (let i = 0; i < 10; i++) {
			store.append("my-mod", "info", `msg-${i}`);
		}

		const result = await runModuleFactory({ action: "logs", name: "my-mod", limit: 3 });
		expect(result.content).toContain("3 entries");
		resetModuleLogStore();
	});

	it("shows empty message when module has no entries", async () => {
		initModuleLogStore(tmpDir);
		const result = await runModuleFactory({ action: "logs", name: "no-logs-mod" });
		expect(result.content).toContain("No log entries");
		resetModuleLogStore();
	});
});
