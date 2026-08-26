import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isPathOutsideRoot, resolveContainedPath } from "./path-containment.js";

const tempDirs: string[] = [];

function makeProjectTempDir(): string {
  const baseDir = join(process.cwd(), ".kota", "test-tmp");
  mkdirSync(baseDir, { recursive: true });
  const dir = mkdtempSync(join(baseDir, "path-containment-"));
  tempDirs.push(dir);
  return dir;
}

function makeOutsideTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kota-path-containment-"));
  tempDirs.push(dir);
  return dir;
}

describe("project path policy", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0).reverse()) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("allows missing files under the scope directory", () => {
    const dir = makeProjectTempDir();
    const target = join(dir, "nested", "response.json");

    const result = resolveContainedPath(target);

    expect(result).toEqual({ ok: true, path: target });
  });

  it("rejects paths outside the scope directory", () => {
    const outsideDir = makeOutsideTempDir();

    expect(isPathOutsideRoot(join(outsideDir, "response.json"))).toBe(true);
  });

  it("allows callers to enforce an explicit scope root outside process cwd", () => {
    const scopeRoot = makeOutsideTempDir();
    const resolvedScopeRoot = realpathSync.native(scopeRoot);

    expect(resolveContainedPath("nested/response.json", scopeRoot, scopeRoot)).toEqual({
      ok: true,
      path: join(resolvedScopeRoot, "nested", "response.json"),
    });
    expect(resolveContainedPath("../escape.json", scopeRoot, scopeRoot)).toEqual({ ok: false });
  });

  it("rejects missing files under symlinked parents that resolve outside the project", () => {
    const scopeRoot = makeProjectTempDir();
    const outsideDir = makeOutsideTempDir();
    const link = join(scopeRoot, "outside-link");
    symlinkSync(outsideDir, link, "dir");

    expect(resolveContainedPath(join(link, "response.json"))).toEqual({ ok: false });
  });

  it("rejects a dangling final symlink that resolves outside the project", () => {
    const scopeRoot = makeProjectTempDir();
    const outsideDir = makeOutsideTempDir();
    const link = join(scopeRoot, "response.json");
    symlinkSync(join(outsideDir, "response.json"), link);

    expect(resolveContainedPath(link)).toEqual({ ok: false });
  });
});
