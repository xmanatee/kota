import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureAnchoredScopeConfigDirectory } from "./scope-config-directory-helper.js";

function identityOf(path: string): { dev: number; ino: number } {
  const stats = lstatSync(path);
  return { dev: stats.dev, ino: stats.ino };
}

describe("ensureAnchoredScopeConfigDirectory", () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    for (const dir of cleanupDirs.splice(0).reverse()) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not create .kota after the captured scope root is replaced", () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-config-root-"));
    const relocatedScopeRoot = `${scopeRoot}-relocated`;
    cleanupDirs.push(scopeRoot, relocatedScopeRoot);
    const scopeRootIdentity = identityOf(scopeRoot);

    renameSync(scopeRoot, relocatedScopeRoot);
    mkdirSync(scopeRoot);

    expect(() =>
      ensureAnchoredScopeConfigDirectory(
        scopeRoot,
        scopeRootIdentity,
      )
    ).toThrow(/scope root changed during the update/);

    expect(existsSync(join(scopeRoot, ".kota"))).toBe(false);
    expect(existsSync(join(relocatedScopeRoot, ".kota"))).toBe(false);
  });

  it("does not create .kota after a captured scope ancestor is replaced", () => {
    const scopeParent = mkdtempSync(join(tmpdir(), "kota-config-parent-"));
    const relocatedScopeParent = `${scopeParent}-relocated`;
    const scopeRoot = join(scopeParent, "scope");
    const relocatedScopeRoot = join(relocatedScopeParent, "scope");
    cleanupDirs.push(scopeParent, relocatedScopeParent);
    mkdirSync(scopeRoot);
    const scopeRootIdentity = identityOf(scopeRoot);

    renameSync(scopeParent, relocatedScopeParent);
    mkdirSync(scopeRoot, { recursive: true });

    expect(() =>
      ensureAnchoredScopeConfigDirectory(
        scopeRoot,
        scopeRootIdentity,
      )
    ).toThrow(/scope root changed during the update/);

    expect(existsSync(join(scopeRoot, ".kota"))).toBe(false);
    expect(existsSync(join(relocatedScopeRoot, ".kota"))).toBe(false);
  });
});
