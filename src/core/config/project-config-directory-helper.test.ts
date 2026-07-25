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
import { ensureAnchoredProjectConfigDirectory } from "./project-config-directory-helper.js";

function identityOf(path: string): { dev: number; ino: number } {
  const stats = lstatSync(path);
  return { dev: stats.dev, ino: stats.ino };
}

describe("ensureAnchoredProjectConfigDirectory", () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    for (const dir of cleanupDirs.splice(0).reverse()) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not create .kota after the captured project root is replaced", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-config-root-"));
    const relocatedProjectDir = `${projectDir}-relocated`;
    cleanupDirs.push(projectDir, relocatedProjectDir);
    const projectRootIdentity = identityOf(projectDir);

    renameSync(projectDir, relocatedProjectDir);
    mkdirSync(projectDir);

    expect(() =>
      ensureAnchoredProjectConfigDirectory(
        projectDir,
        projectRootIdentity,
      )
    ).toThrow(/project root changed during the update/);

    expect(existsSync(join(projectDir, ".kota"))).toBe(false);
    expect(existsSync(join(relocatedProjectDir, ".kota"))).toBe(false);
  });

  it("does not create .kota after a captured project ancestor is replaced", () => {
    const projectParent = mkdtempSync(join(tmpdir(), "kota-config-parent-"));
    const relocatedProjectParent = `${projectParent}-relocated`;
    const projectDir = join(projectParent, "project");
    const relocatedProjectDir = join(relocatedProjectParent, "project");
    cleanupDirs.push(projectParent, relocatedProjectParent);
    mkdirSync(projectDir);
    const projectRootIdentity = identityOf(projectDir);

    renameSync(projectParent, relocatedProjectParent);
    mkdirSync(projectDir, { recursive: true });

    expect(() =>
      ensureAnchoredProjectConfigDirectory(
        projectDir,
        projectRootIdentity,
      )
    ).toThrow(/project root changed during the update/);

    expect(existsSync(join(projectDir, ".kota"))).toBe(false);
    expect(existsSync(join(relocatedProjectDir, ".kota"))).toBe(false);
  });
});
