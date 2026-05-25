import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isOutsideProject, resolveProjectPath } from "./project-path-policy.js";

const tempDirs: string[] = [];

function makeProjectTempDir(): string {
  const baseDir = join(process.cwd(), ".kota", "test-tmp");
  mkdirSync(baseDir, { recursive: true });
  const dir = mkdtempSync(join(baseDir, "project-path-policy-"));
  tempDirs.push(dir);
  return dir;
}

function makeOutsideTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kota-project-path-policy-"));
  tempDirs.push(dir);
  return dir;
}

describe("project path policy", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0).reverse()) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("allows missing files under the project directory", () => {
    const dir = makeProjectTempDir();
    const target = join(dir, "nested", "response.json");

    const result = resolveProjectPath(target);

    expect(result).toEqual({ ok: true, path: target });
  });

  it("rejects paths outside the project directory", () => {
    const outsideDir = makeOutsideTempDir();

    expect(isOutsideProject(join(outsideDir, "response.json"))).toBe(true);
  });

  it("rejects missing files under symlinked parents that resolve outside the project", () => {
    const projectDir = makeProjectTempDir();
    const outsideDir = makeOutsideTempDir();
    const link = join(projectDir, "outside-link");
    symlinkSync(outsideDir, link, "dir");

    expect(resolveProjectPath(join(link, "response.json"))).toEqual({ ok: false });
  });

  it("rejects a dangling final symlink that resolves outside the project", () => {
    const projectDir = makeProjectTempDir();
    const outsideDir = makeOutsideTempDir();
    const link = join(projectDir, "response.json");
    symlinkSync(join(outsideDir, "response.json"), link);

    expect(resolveProjectPath(link)).toEqual({ ok: false });
  });
});
