import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getInstalledNpmPackages,
  getPackagesNodeModulesDir,
  installTool,
  listTools,
  loadManifest,
  parseSource,
  removeTool,
  saveManifest,
  type ToolManifest,
  updateTool,
} from "./registry.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `kota-registry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("parseSource", () => {
  it("parses npm: prefix", () => {
    const result = parseSource("npm:@scope/kota-weather");
    expect(result.type).toBe("npm");
    expect(result.identifier).toBe("@scope/kota-weather");
    expect(result.name).toBe("weather");
  });

  it("parses bare package name as npm", () => {
    const result = parseSource("kota-search");
    expect(result.type).toBe("npm");
    expect(result.identifier).toBe("kota-search");
    expect(result.name).toBe("search");
  });

  it("parses github: prefix", () => {
    const result = parseSource("github:user/kota-tool-calc");
    expect(result.type).toBe("github");
    expect(result.identifier).toBe("user/kota-tool-calc");
    expect(result.name).toBe("calc");
  });

  it("parses owner/repo shorthand as github", () => {
    const result = parseSource("user/my-tool");
    expect(result.type).toBe("github");
    expect(result.identifier).toBe("user/my-tool");
    expect(result.name).toBe("my-tool");
  });

  it("parses https URL", () => {
    const result = parseSource("https://example.com/plugins/weather.mjs");
    expect(result.type).toBe("url");
    expect(result.identifier).toBe("https://example.com/plugins/weather.mjs");
    expect(result.name).toBe("weather");
  });

  it("parses http URL", () => {
    const result = parseSource("http://localhost:8080/tool.js");
    expect(result.type).toBe("url");
    expect(result.name).toBe("tool");
  });

  it("strips kota- and tool- prefixes from names", () => {
    expect(parseSource("kota-weather").name).toBe("weather");
    expect(parseSource("tool-calc").name).toBe("calc");
    expect(parseSource("npm:kota-search").name).toBe("search");
    expect(parseSource("github:user/tool-email").name).toBe("email");
  });

  it("handles scoped npm packages", () => {
    const result = parseSource("npm:@company/my-tool");
    expect(result.type).toBe("npm");
    expect(result.identifier).toBe("@company/my-tool");
    expect(result.name).toBe("my-tool");
  });

  it("handles URL without file extension", () => {
    const result = parseSource("https://example.com/api/tool");
    expect(result.type).toBe("url");
    expect(result.name).toBe("tool");
  });
});

describe("manifest operations", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty manifest when file does not exist", () => {
    const manifest = loadManifest(tmpDir);
    expect(manifest).toEqual({ tools: {} });
  });

  it("saves and loads manifest", () => {
    const manifest: ToolManifest = {
      tools: {
        weather: {
          source: "npm",
          uri: "kota-weather",
          version: "1.0.0",
          files: ["packages/node_modules/kota-weather"],
          installedAt: "2026-03-15T00:00:00.000Z",
        },
      },
    };

    saveManifest(manifest, tmpDir);
    const loaded = loadManifest(tmpDir);
    expect(loaded).toEqual(manifest);
  });

  it("creates .kota directory if needed", () => {
    const subDir = join(tmpDir, "nested");
    mkdirSync(subDir);
    saveManifest({ tools: {} }, subDir);
    expect(existsSync(join(subDir, ".kota", "tools.json"))).toBe(true);
  });

  it("handles corrupted manifest file", () => {
    mkdirSync(join(tmpDir, ".kota"), { recursive: true });
    writeFileSync(join(tmpDir, ".kota", "tools.json"), "not json{{{");
    const manifest = loadManifest(tmpDir);
    expect(manifest).toEqual({ tools: {} });
  });

  it("handles manifest with wrong structure", () => {
    mkdirSync(join(tmpDir, ".kota"), { recursive: true });
    writeFileSync(join(tmpDir, ".kota", "tools.json"), JSON.stringify([1, 2, 3]));
    const manifest = loadManifest(tmpDir);
    expect(manifest).toEqual({ tools: {} });
  });
});

describe("removeTool", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns false for nonexistent tool", () => {
    expect(removeTool("nonexistent", tmpDir)).toBe(false);
  });

  it("removes tool and its files from manifest", () => {
    // Create a plugin file
    const pluginsDir = join(tmpDir, ".kota", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, "weather.mjs"), "export default {}");

    // Create manifest with the tool
    saveManifest({
      tools: {
        weather: {
          source: "url",
          uri: "https://example.com/weather.mjs",
          version: "latest",
          files: ["plugins/weather.mjs"],
          installedAt: "2026-03-15T00:00:00.000Z",
        },
      },
    }, tmpDir);

    const removed = removeTool("weather", tmpDir);
    expect(removed).toBe(true);

    // File should be deleted
    expect(existsSync(join(pluginsDir, "weather.mjs"))).toBe(false);

    // Manifest should be updated
    const manifest = loadManifest(tmpDir);
    expect(manifest.tools.weather).toBeUndefined();
  });

  it("handles missing files gracefully", () => {
    saveManifest({
      tools: {
        ghost: {
          source: "url",
          uri: "https://example.com/ghost.mjs",
          version: "latest",
          files: ["plugins/ghost.mjs"],
          installedAt: "2026-03-15T00:00:00.000Z",
        },
      },
    }, tmpDir);

    // File doesn't exist but removal should still succeed
    expect(removeTool("ghost", tmpDir)).toBe(true);
    expect(loadManifest(tmpDir).tools.ghost).toBeUndefined();
  });
});

describe("listTools", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when no tools installed", () => {
    expect(listTools(tmpDir)).toEqual([]);
  });

  it("returns all installed tools with names", () => {
    saveManifest({
      tools: {
        weather: {
          source: "npm",
          uri: "kota-weather",
          version: "1.0.0",
          files: ["packages/node_modules/kota-weather"],
          installedAt: "2026-03-15T00:00:00.000Z",
        },
        calc: {
          source: "url",
          uri: "https://example.com/calc.mjs",
          version: "latest",
          files: ["plugins/calc.mjs"],
          installedAt: "2026-03-14T00:00:00.000Z",
        },
      },
    }, tmpDir);

    const tools = listTools(tmpDir);
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name).sort()).toEqual(["calc", "weather"]);
    expect(tools.find((t) => t.name === "weather")?.source).toBe("npm");
    expect(tools.find((t) => t.name === "calc")?.version).toBe("latest");
  });
});

describe("getInstalledNpmPackages", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when no tools", () => {
    expect(getInstalledNpmPackages(tmpDir)).toEqual([]);
  });

  it("returns only npm/github sources", () => {
    saveManifest({
      tools: {
        npmTool: {
          source: "npm",
          uri: "kota-weather",
          version: "1.0.0",
          files: [],
          installedAt: "2026-03-15T00:00:00.000Z",
        },
        urlTool: {
          source: "url",
          uri: "https://example.com/tool.mjs",
          version: "latest",
          files: [],
          installedAt: "2026-03-15T00:00:00.000Z",
        },
        githubTool: {
          source: "github",
          uri: "user/repo",
          version: "1.0.0",
          files: [],
          installedAt: "2026-03-15T00:00:00.000Z",
        },
      },
    }, tmpDir);

    const packages = getInstalledNpmPackages(tmpDir);
    expect(packages).toContain("kota-weather");
    expect(packages).toContain("user/repo");
    expect(packages).not.toContain("https://example.com/tool.mjs");
  });
});

describe("getPackagesNodeModulesDir", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when directory does not exist", () => {
    expect(getPackagesNodeModulesDir(tmpDir)).toBeNull();
  });

  it("returns path when directory exists", () => {
    const dir = join(tmpDir, ".kota", "packages", "node_modules");
    mkdirSync(dir, { recursive: true });
    const result = getPackagesNodeModulesDir(tmpDir);
    expect(result).toBe(dir);
  });
});

describe("parseSource edge cases", () => {
  it("treats shell metacharacters as npm package name (no injection)", () => {
    const result = parseSource("foo; rm -rf /");
    expect(result.type).toBe("npm");
    expect(result.identifier).toBe("foo; rm -rf /");
  });

  it("treats backtick subshell as npm package name", () => {
    const result = parseSource("foo`whoami`bar");
    expect(result.type).toBe("npm");
    expect(result.identifier).toBe("foo`whoami`bar");
  });

  it("treats pipe as npm package name", () => {
    const result = parseSource("foo | cat /etc/passwd");
    expect(result.type).toBe("npm");
  });

  it("handles URL with no path gracefully", () => {
    const result = parseSource("https://example.com");
    expect(result.type).toBe("url");
    expect(result.name).toBeTruthy();
  });

  it("handles URL with root path only", () => {
    const result = parseSource("https://example.com/");
    expect(result.type).toBe("url");
    expect(result.name).toBeTruthy();
  });
});

describe("installTool error paths", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects duplicate tool installation", async () => {
    saveManifest({
      tools: {
        weather: {
          source: "npm",
          uri: "kota-weather",
          version: "1.0.0",
          files: ["packages/node_modules/kota-weather"],
          installedAt: "2026-03-15T00:00:00.000Z",
        },
      },
    }, tmpDir);

    await expect(installTool("kota-weather", tmpDir)).rejects.toThrow(
      /already installed/,
    );
  });

  it("rejects duplicate with helpful message including remove command", async () => {
    saveManifest({
      tools: {
        weather: {
          source: "npm",
          uri: "kota-weather",
          version: "1.0.0",
          files: [],
          installedAt: "2026-03-15T00:00:00.000Z",
        },
      },
    }, tmpDir);

    await expect(installTool("kota-weather", tmpDir)).rejects.toThrow(
      /kota tools remove weather/,
    );
  });
});

describe("installTool URL error paths", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("rejects when fetch returns non-OK status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not Found", { status: 404, statusText: "Not Found" }),
    );

    await expect(installTool("https://example.com/tool.mjs", tmpDir)).rejects.toThrow(
      /Download failed: 404/,
    );
  });

  it("rejects when fetch throws a network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("getaddrinfo ENOTFOUND example.com"),
    );

    await expect(installTool("https://example.com/tool.mjs", tmpDir)).rejects.toThrow(
      /Download failed for/,
    );
    await expect(installTool("https://example.com/tool.mjs", tmpDir)).rejects.toThrow(
      /ENOTFOUND/,
    );
  });

  it("rejects HTML responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html><body>Please export your credentials</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    );

    await expect(installTool("https://example.com/tool.mjs", tmpDir)).rejects.toThrow(
      /HTML instead of JavaScript/,
    );
  });

  it("rejects content without valid JS exports", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("const x = 42; // just a random script, no exports", {
        status: 200,
        headers: { "Content-Type": "application/javascript" },
      }),
    );

    await expect(installTool("https://example.com/tool.mjs", tmpDir)).rejects.toThrow(
      /no exports found/,
    );
  });

  it("accepts content with ESM export default", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("export default { name: 'test' };", {
        status: 200,
        headers: { "Content-Type": "application/javascript" },
      }),
    );

    const result = await installTool("https://example.com/tool.mjs", tmpDir);
    expect(result.name).toBe("tool");
    expect(result.source).toBe("url");
  });

  it("accepts content with CJS module.exports", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("module.exports = { name: 'test' };", {
        status: 200,
        headers: { "Content-Type": "application/javascript" },
      }),
    );

    const result = await installTool("https://example.com/cjs-tool.js", tmpDir);
    expect(result.source).toBe("url");
  });

  it("rejects when plugin file already exists", async () => {
    // Pre-create the file
    const pluginsDir = join(tmpDir, ".kota", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, "tool.mjs"), "existing");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("export default {};", { status: 200 }),
    );

    await expect(installTool("https://example.com/tool.mjs", tmpDir)).rejects.toThrow(
      /already exists in plugins/,
    );
  });

  it("does not write file on validation failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("no valid js here", {
        status: 200,
        headers: { "Content-Type": "application/javascript" },
      }),
    );

    await expect(installTool("https://example.com/bad.mjs", tmpDir)).rejects.toThrow();

    // File should not have been created
    expect(existsSync(join(tmpDir, ".kota", "plugins", "bad.mjs"))).toBe(false);
  });

  it("does not update manifest on install failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    await expect(installTool("https://example.com/tool.mjs", tmpDir)).rejects.toThrow();

    const manifest = loadManifest(tmpDir);
    expect(Object.keys(manifest.tools)).toHaveLength(0);
  });
});

describe("updateTool error paths", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("throws for nonexistent tool", async () => {
    await expect(updateTool("nonexistent", tmpDir)).rejects.toThrow(
      /not installed/,
    );
  });

  it("preserves manifest entry when reinstall fails", async () => {
    // Set up an existing URL-based tool
    const pluginsDir = join(tmpDir, ".kota", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, "weather.mjs"), "export default {}");

    saveManifest({
      tools: {
        weather: {
          source: "url",
          uri: "https://example.com/weather.mjs",
          version: "latest",
          files: ["plugins/weather.mjs"],
          installedAt: "2026-03-15T00:00:00.000Z",
        },
      },
    }, tmpDir);

    // Make the reinstall fail
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network timeout"));

    await expect(updateTool("weather", tmpDir)).rejects.toThrow(/network timeout/);

    // The manifest entry should be restored
    const manifest = loadManifest(tmpDir);
    expect(manifest.tools.weather).toBeDefined();
    expect(manifest.tools.weather.uri).toBe("https://example.com/weather.mjs");
  });

  it("preserves original files on disk when reinstall fails", async () => {
    const pluginsDir = join(tmpDir, ".kota", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, "myutil.mjs"), "export const x = 1;");

    saveManifest({
      tools: {
        myutil: {
          source: "url",
          uri: "https://example.com/myutil.mjs",
          version: "latest",
          files: ["plugins/myutil.mjs"],
          installedAt: "2026-03-15T00:00:00.000Z",
        },
      },
    }, tmpDir);

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("DNS failure"));

    await expect(updateTool("myutil", tmpDir)).rejects.toThrow();

    // File should still exist on disk
    expect(existsSync(join(pluginsDir, "myutil.mjs"))).toBe(true);
    expect(readFileSync(join(pluginsDir, "myutil.mjs"), "utf-8")).toBe("export const x = 1;");
  });

  it("succeeds and updates manifest on successful reinstall", async () => {
    const pluginsDir = join(tmpDir, ".kota", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, "mytool.mjs"), "export default { v: 1 };");

    saveManifest({
      tools: {
        mytool: {
          source: "url",
          uri: "https://example.com/mytool.mjs",
          version: "latest",
          files: ["plugins/mytool.mjs"],
          installedAt: "2026-03-15T00:00:00.000Z",
        },
      },
    }, tmpDir);

    // Remove existing file so installUrl doesn't complain about duplicate
    rmSync(join(pluginsDir, "mytool.mjs"));

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("export default { v: 2 };", {
        status: 200,
        headers: { "Content-Type": "application/javascript" },
      }),
    );

    const result = await updateTool("mytool", tmpDir);
    expect(result.name).toBe("mytool");

    // Manifest should be updated with new entry
    const manifest = loadManifest(tmpDir);
    expect(manifest.tools.mytool).toBeDefined();
    // New file should exist
    expect(existsSync(join(pluginsDir, "mytool.mjs"))).toBe(true);
  });
});

describe("saveManifest atomic writes", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not leave .tmp files after successful save", () => {
    saveManifest({ tools: {} }, tmpDir);
    const kotaDir = join(tmpDir, ".kota");
    const files = readdirSync(kotaDir);
    expect(files).toContain("tools.json");
    expect(files).not.toContain("tools.json.tmp");
  });

  it("recovers manifest from .tmp file when primary is missing", () => {
    // Simulate crash: tmp was written but rename never happened
    const kotaDir = join(tmpDir, ".kota");
    mkdirSync(kotaDir, { recursive: true });
    const manifest = { tools: { t: { source: "npm" as const, uri: "pkg", version: "1.0.0", files: [], installedAt: "2026-01-01T00:00:00.000Z" } } };
    writeFileSync(join(kotaDir, "tools.json.tmp"), JSON.stringify(manifest, null, 2));
    // No tools.json exists — only the .tmp

    const loaded = loadManifest(tmpDir);
    expect(loaded.tools.t).toBeDefined();
    expect(loaded.tools.t.uri).toBe("pkg");
  });

  it("prefers primary over .tmp when both exist", () => {
    const kotaDir = join(tmpDir, ".kota");
    mkdirSync(kotaDir, { recursive: true });
    const primary = { tools: { a: { source: "npm" as const, uri: "a", version: "1.0.0", files: [], installedAt: "2026-01-01T00:00:00.000Z" } } };
    const stale = { tools: { b: { source: "npm" as const, uri: "b", version: "1.0.0", files: [], installedAt: "2026-01-01T00:00:00.000Z" } } };
    writeFileSync(join(kotaDir, "tools.json"), JSON.stringify(primary, null, 2));
    writeFileSync(join(kotaDir, "tools.json.tmp"), JSON.stringify(stale, null, 2));

    const loaded = loadManifest(tmpDir);
    expect(loaded.tools.a).toBeDefined();
    expect(loaded.tools.b).toBeUndefined();
  });

  it("falls back to .tmp when primary is corrupted", () => {
    const kotaDir = join(tmpDir, ".kota");
    mkdirSync(kotaDir, { recursive: true });
    writeFileSync(join(kotaDir, "tools.json"), "corrupted{{{");
    const fallback = { tools: { x: { source: "url" as const, uri: "http://x", version: "latest", files: [], installedAt: "2026-01-01T00:00:00.000Z" } } };
    writeFileSync(join(kotaDir, "tools.json.tmp"), JSON.stringify(fallback, null, 2));

    const loaded = loadManifest(tmpDir);
    expect(loaded.tools.x).toBeDefined();
    expect(loaded.tools.x.uri).toBe("http://x");
  });

  it("returns empty manifest when both primary and .tmp are corrupted", () => {
    const kotaDir = join(tmpDir, ".kota");
    mkdirSync(kotaDir, { recursive: true });
    writeFileSync(join(kotaDir, "tools.json"), "bad");
    writeFileSync(join(kotaDir, "tools.json.tmp"), "also bad");

    const loaded = loadManifest(tmpDir);
    expect(loaded).toEqual({ tools: {} });
  });
});

describe("updateTool backup lifecycle", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("removes .kota-update-bak files after successful update", async () => {
    const pluginsDir = join(tmpDir, ".kota", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, "tool.mjs"), "export default { v: 1 };");

    saveManifest({
      tools: {
        tool: {
          source: "url",
          uri: "https://example.com/tool.mjs",
          version: "latest",
          files: ["plugins/tool.mjs"],
          installedAt: "2026-03-15T00:00:00.000Z",
        },
      },
    }, tmpDir);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("export default { v: 2 };", {
        status: 200,
        headers: { "Content-Type": "application/javascript" },
      }),
    );

    await updateTool("tool", tmpDir);

    // Backup file must not persist
    expect(existsSync(join(pluginsDir, "tool.mjs.kota-update-bak"))).toBe(false);
    // New file should exist
    expect(existsSync(join(pluginsDir, "tool.mjs"))).toBe(true);
  });

  it("restores files and manifest when backup rename fails mid-loop", async () => {
    const pluginsDir = join(tmpDir, ".kota", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, "a.mjs"), "export const a = 1;");
    writeFileSync(join(pluginsDir, "b.mjs"), "export const b = 2;");

    saveManifest({
      tools: {
        multi: {
          source: "url",
          uri: "https://example.com/multi.mjs",
          version: "latest",
          files: ["plugins/a.mjs", "plugins/b.mjs"],
          installedAt: "2026-03-15T00:00:00.000Z",
        },
      },
    }, tmpDir);

    // Make renameSync fail on the second call (b.mjs backup) by
    // intercepting the fs.renameSync import. We can't easily mock
    // node:fs imports, so instead we make the second file unreadable
    // by removing it — renameSync on a missing path throws ENOENT,
    // but existsSync would skip it. Instead, let's make the backup
    // target path invalid by creating a directory there.
    const backupPath = join(pluginsDir, "b.mjs.kota-update-bak");
    mkdirSync(backupPath, { recursive: true });
    // Put a file inside so renameSync(file, dir-with-contents) fails
    writeFileSync(join(backupPath, "blocker"), "x");

    await expect(updateTool("multi", tmpDir)).rejects.toThrow();

    // The first file (a.mjs) should be restored from its backup
    expect(existsSync(join(pluginsDir, "a.mjs"))).toBe(true);
    expect(readFileSync(join(pluginsDir, "a.mjs"), "utf-8")).toBe("export const a = 1;");

    // Manifest should be restored with the tool entry
    const manifest = loadManifest(tmpDir);
    expect(manifest.tools.multi).toBeDefined();
    expect(manifest.tools.multi.uri).toBe("https://example.com/multi.mjs");
  });

  it("does not leave backup files when install fails", async () => {
    const pluginsDir = join(tmpDir, ".kota", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, "fail.mjs"), "export default {}");

    saveManifest({
      tools: {
        fail: {
          source: "url",
          uri: "https://example.com/fail.mjs",
          version: "latest",
          files: ["plugins/fail.mjs"],
          installedAt: "2026-03-15T00:00:00.000Z",
        },
      },
    }, tmpDir);

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection reset"));

    await expect(updateTool("fail", tmpDir)).rejects.toThrow(/connection reset/);

    // Backup file should be cleaned up (restored to original path)
    expect(existsSync(join(pluginsDir, "fail.mjs.kota-update-bak"))).toBe(false);
    // Original file restored
    expect(existsSync(join(pluginsDir, "fail.mjs"))).toBe(true);
  });
});
