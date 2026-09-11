import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	deleteManifest,
	listManifestModules,
	loadManifest,
	saveManifest,
} from "./persistence.js";
import type { ModuleManifest } from "./types.js";

describe("manifest persistence edge cases", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = join(tmpdir(), `kota-persist-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tmpDir, { recursive: true });
	});

	afterEach(() => {
		try { rmSync(tmpDir, { recursive: true }); } catch { /* */ }
	});

	const minimal: ModuleManifest = { name: "test-mod" };

  it("rejects traversal at the persistence boundary", () => {
    expect(() => loadManifest("../outside", tmpDir)).toThrow("Invalid module name");
    expect(() => deleteManifest("../outside", tmpDir)).toThrow("Invalid module name");
    expect(() => saveManifest({ name: "../outside" }, tmpDir)).toThrow("Invalid module name");
    expect(existsSync(join(tmpDir, ".kota", "outside"))).toBe(false);
  });

	it("saveManifest creates nested directory structure", () => {
		const path = saveManifest(minimal, tmpDir);
		expect(existsSync(path)).toBe(true);
		expect(path).toContain(join(".kota", "modules", "test-mod", "manifest.json"));
	});

	it("saveManifest overwrites existing manifest", () => {
		saveManifest(minimal, tmpDir);
		const updated = { ...minimal, description: "updated" };
		saveManifest(updated, tmpDir);
		const loaded = loadManifest("test-mod", tmpDir);
		expect(loaded?.description).toBe("updated");
	});

	it("loadManifest reports malformed JSON", () => {
		const dir = join(tmpDir, ".kota", "modules", "bad-json");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "manifest.json"), "{invalid json");
		expect(() => loadManifest("bad-json", tmpDir)).toThrow();
	});

	it("deleteManifest returns false when directory exists but no manifest.json", () => {
		const dir = join(tmpDir, ".kota", "modules", "no-manifest");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "data.txt"), "some data");
		expect(deleteManifest("no-manifest", tmpDir)).toBe(false);
	});

	it("deleteManifest preserves the shared directory after removing its manifest", () => {
		saveManifest(minimal, tmpDir);
		deleteManifest("test-mod", tmpDir);
		expect(existsSync(join(tmpDir, ".kota", "modules", "test-mod"))).toBe(true);
	});

	it("deleteManifest preserves directory when other files exist", () => {
		saveManifest(minimal, tmpDir);
		const extraFile = join(tmpDir, ".kota", "modules", "test-mod", "storage.db");
		writeFileSync(extraFile, "data");
		deleteManifest("test-mod", tmpDir);
		expect(existsSync(extraFile)).toBe(true);
		expect(existsSync(join(tmpDir, ".kota", "modules", "test-mod"))).toBe(true);
	});



	it("listManifestModules returns empty for non-existent modules dir", () => {
		const list = listManifestModules(tmpDir);
		expect(list).toHaveLength(0);
	});

	it("listManifestModules returns multiple modules sorted by directory order", () => {
		saveManifest({ name: "alpha-mod" }, tmpDir);
		saveManifest({ name: "beta-mod", description: "B" }, tmpDir);
		saveManifest({ name: "gamma-mod", version: "2.0.0" }, tmpDir);
		const list = listManifestModules(tmpDir);
		expect(list).toHaveLength(3);
		const names = list.map((l) => l.name).sort();
		expect(names).toEqual(["alpha-mod", "beta-mod", "gamma-mod"]);
	});

  it("ignores files beside module directories", () => {
    saveManifest(minimal, tmpDir);
    writeFileSync(join(tmpDir, ".kota", "modules", ".DS_Store"), "metadata");
    expect(listManifestModules(tmpDir).map(({ name }) => name)).toEqual([minimal.name]);
  });

  it("rejects a manifest whose identity differs from its directory", () => {
    const path = saveManifest(minimal, tmpDir);
    writeFileSync(path, JSON.stringify({ name: "another-mod" }));
    expect(() => loadManifest(minimal.name, tmpDir)).toThrow("does not match its directory");
  });

	it("saveManifest with tools preserves tool definitions", () => {
		const withTools: ModuleManifest = {
			name: "tool-mod",
			tools: [{
				name: "my_tool",
				description: "A tool",
				code: "print(1)",
				language: "python",
			}],
		};
		saveManifest(withTools, tmpDir);
		const loaded = loadManifest("tool-mod", tmpDir);
		expect(loaded?.tools).toHaveLength(1);
		expect(loaded?.tools?.[0].name).toBe("my_tool");
		expect(loaded?.tools?.[0].language).toBe("python");
	});

});
