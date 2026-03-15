import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getInstalledNpmPackages,
  getPackagesNodeModulesDir,
  listTools,
  loadManifest,
  parseSource,
  removeTool,
  saveManifest,
  type ToolManifest,
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
