import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isProtectedProjectPath } from "#core/tools/protected-project-paths.js";

const tempDirs: string[] = [];

function makeProjectTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kota-protected-paths-"));
  tempDirs.push(dir);
  return dir;
}

describe("protected project paths", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0).reverse()) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("denies symlink aliases to selected project secrets and env files", () => {
    const projectDir = makeProjectTempDir();
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(join(projectDir, ".kota", "secrets.json"), "{}\n");
    writeFileSync(join(projectDir, ".env"), "TOKEN=value\n");

    try {
      symlinkSync(join(projectDir, ".kota", "secrets.json"), join(projectDir, "secret-link.json"));
      symlinkSync(join(projectDir, ".env"), join(projectDir, "env-link"));
      symlinkSync(join(projectDir, ".kota"), join(projectDir, "runtime-link"), "dir");
    } catch {
      return;
    }

    const context = { cwd: projectDir };
    expect(isProtectedProjectPath("secret-link.json", context)).toBe(true);
    expect(isProtectedProjectPath(join(projectDir, "env-link"), context)).toBe(true);
    expect(isProtectedProjectPath(join(projectDir, "runtime-link", "secrets.json"), context)).toBe(true);
  });

  it("denies the machine-owned scope authority token outside the project", () => {
    const projectDir = makeProjectTempDir();
    const operatorDir = makeProjectTempDir();
    expect(
      isProtectedProjectPath(
        join(operatorDir, "scope-authority-token.json"),
        { cwd: projectDir, authorityConfigPath: join(operatorDir, "config.json") },
      ),
    ).toBe(true);
  });

  it("denies an innocuously named symlink to the external operator token", () => {
    const projectDir = makeProjectTempDir();
    const operatorDir = makeProjectTempDir();
    const tokenPath = join(operatorDir, "scope-authority-token.json");
    writeFileSync(tokenPath, JSON.stringify({ schema: 1, token: "a".repeat(64) }));
    try {
      symlinkSync(tokenPath, join(projectDir, "notes.json"));
    } catch {
      return;
    }

    expect(isProtectedProjectPath("notes.json", {
      cwd: projectDir,
      authorityConfigPath: join(operatorDir, "config.json"),
    })).toBe(true);
  });
});
