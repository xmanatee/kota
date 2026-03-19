import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSource } from "./registry.js";
import {
  getNpmVersion,
  installUrl,
  resolveInstalledPackageName,
} from "./registry-installers.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `kota-installers-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("installUrl filename derivation", () => {
  let kotaDir: string;

  beforeEach(() => {
    kotaDir = join(makeTmpDir(), ".kota");
    mkdirSync(kotaDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(kotaDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function mockFetch(content: string) {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(content, {
        status: 200,
        headers: { "Content-Type": "application/javascript" },
      }),
    );
  }

  it("preserves .js filename from URL path", async () => {
    mockFetch("export default {};");
    const parsed = parseSource("https://example.com/path/to/weather.js");
    const result = await installUrl(parsed, kotaDir);
    expect(result.files).toEqual(["plugins/weather.js"]);
  });

  it("preserves .mjs filename from URL path", async () => {
    mockFetch("export default {};");
    const parsed = parseSource("https://example.com/weather.mjs");
    const result = await installUrl(parsed, kotaDir);
    expect(result.files).toEqual(["plugins/weather.mjs"]);
  });

  it("uses derived name with .mjs for non-JS extensions", async () => {
    mockFetch("export default {};");
    const parsed = parseSource("https://example.com/tool.ts");
    const result = await installUrl(parsed, kotaDir);
    // URL "tool.ts" → name "tool" → filename "tool.mjs"
    expect(result.files).toEqual(["plugins/tool.mjs"]);
  });

  it("uses derived name with .mjs for URLs without extension", async () => {
    mockFetch("export default {};");
    const parsed = parseSource("https://example.com/api/module");
    const result = await installUrl(parsed, kotaDir);
    expect(result.files).toEqual(["plugins/module.mjs"]);
  });

  it("strips query string from filename", async () => {
    mockFetch("export default {};");
    const parsed = parseSource("https://example.com/tool.js?v=2&token=abc");
    const result = await installUrl(parsed, kotaDir);
    expect(result.files).toEqual(["plugins/tool.js"]);
  });

  it("strips fragment from filename", async () => {
    mockFetch("export default {};");
    const parsed = parseSource("https://example.com/tool.mjs#section");
    const result = await installUrl(parsed, kotaDir);
    expect(result.files).toEqual(["plugins/tool.mjs"]);
  });

  it("handles URL with only root path", async () => {
    mockFetch("export default {};");
    const parsed = parseSource("https://example.com/");
    const result = await installUrl(parsed, kotaDir);
    // Root path → empty basename → falls back to name-derived filename
    expect(result.files).toEqual(["plugins/tool.mjs"]);
  });
});

describe("getNpmVersion", () => {
  let kotaDir: string;

  beforeEach(() => {
    kotaDir = join(makeTmpDir(), ".kota");
    mkdirSync(kotaDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(kotaDir, { recursive: true, force: true });
  });

  it("reads version from regular package", () => {
    const pkgPath = join(kotaDir, "packages", "node_modules", "my-tool", "package.json");
    mkdirSync(join(kotaDir, "packages", "node_modules", "my-tool"), { recursive: true });
    writeFileSync(pkgPath, JSON.stringify({ name: "my-tool", version: "2.3.1" }));

    expect(getNpmVersion("my-tool", kotaDir)).toBe("2.3.1");
  });

  it("reads version from scoped package", () => {
    const pkgPath = join(kotaDir, "packages", "node_modules", "@scope", "my-tool", "package.json");
    mkdirSync(join(kotaDir, "packages", "node_modules", "@scope", "my-tool"), { recursive: true });
    writeFileSync(pkgPath, JSON.stringify({ name: "@scope/my-tool", version: "1.0.5" }));

    expect(getNpmVersion("@scope/my-tool", kotaDir)).toBe("1.0.5");
  });

  it("returns unknown for missing package", () => {
    mkdirSync(join(kotaDir, "packages", "node_modules"), { recursive: true });
    expect(getNpmVersion("nonexistent", kotaDir)).toBe("unknown");
  });

  it("returns unknown when package.json has no version field", () => {
    const pkgPath = join(kotaDir, "packages", "node_modules", "no-ver", "package.json");
    mkdirSync(join(kotaDir, "packages", "node_modules", "no-ver"), { recursive: true });
    writeFileSync(pkgPath, JSON.stringify({ name: "no-ver" }));

    expect(getNpmVersion("no-ver", kotaDir)).toBe("unknown");
  });

  it("returns unknown for corrupted package.json", () => {
    const pkgPath = join(kotaDir, "packages", "node_modules", "bad", "package.json");
    mkdirSync(join(kotaDir, "packages", "node_modules", "bad"), { recursive: true });
    writeFileSync(pkgPath, "not json{{{");

    expect(getNpmVersion("bad", kotaDir)).toBe("unknown");
  });
});

describe("resolveInstalledPackageName", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds package name from github spec in dependencies", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: { "cool-tool": "github:user/my-repo" },
      }),
    );
    expect(resolveInstalledPackageName(tmpDir, "user/my-repo")).toBe("cool-tool");
  });

  it("finds package name when spec contains identifier without prefix", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: { "actual-name": "user/my-tool#main" },
      }),
    );
    expect(resolveInstalledPackageName(tmpDir, "user/my-tool")).toBe("actual-name");
  });

  it("falls back to repo name when no matching dependency found", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: { "other-pkg": "1.0.0" },
      }),
    );
    expect(resolveInstalledPackageName(tmpDir, "user/my-tool")).toBe("my-tool");
  });

  it("falls back to repo name when dependencies is missing", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "kota-packages" }));
    expect(resolveInstalledPackageName(tmpDir, "user/my-tool")).toBe("my-tool");
  });

  it("falls back to repo name when package.json is missing", () => {
    expect(resolveInstalledPackageName(tmpDir, "user/my-tool")).toBe("my-tool");
  });

  it("falls back to repo name when package.json is corrupted", () => {
    writeFileSync(join(tmpDir, "package.json"), "not-json{{{");
    expect(resolveInstalledPackageName(tmpDir, "user/my-tool")).toBe("my-tool");
  });

  it("matches when repo name equals package name (common case)", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: { "my-tool": "github:user/my-tool" },
      }),
    );
    expect(resolveInstalledPackageName(tmpDir, "user/my-tool")).toBe("my-tool");
  });
});
