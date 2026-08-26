import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isProtectedScopePath } from "#core/tools/protected-scope-paths.js";

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

  it("denies symlink aliases to selected scope secrets and env files", () => {
    const scopeRoot = makeProjectTempDir();
    mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
    writeFileSync(join(scopeRoot, ".kota", "secrets.json"), "{}\n");
    writeFileSync(join(scopeRoot, ".env"), "TOKEN=value\n");

    try {
      symlinkSync(join(scopeRoot, ".kota", "secrets.json"), join(scopeRoot, "secret-link.json"));
      symlinkSync(join(scopeRoot, ".env"), join(scopeRoot, "env-link"));
      symlinkSync(join(scopeRoot, ".kota"), join(scopeRoot, "runtime-link"), "dir");
    } catch {
      return;
    }

    const context = { cwd: scopeRoot };
    expect(isProtectedScopePath("secret-link.json", context)).toBe(true);
    expect(isProtectedScopePath(join(scopeRoot, "env-link"), context)).toBe(true);
    expect(isProtectedScopePath(join(scopeRoot, "runtime-link", "secrets.json"), context)).toBe(true);
  });

  it("denies the machine-owned scope authority token outside the project", () => {
    const scopeRoot = makeProjectTempDir();
    const operatorDir = makeProjectTempDir();
    expect(
      isProtectedScopePath(
        join(operatorDir, "scope-authority-token.json"),
        { cwd: scopeRoot, authorityConfigPath: join(operatorDir, "config.json") },
      ),
    ).toBe(true);
  });

  it("denies an innocuously named symlink to the external operator token", () => {
    const scopeRoot = makeProjectTempDir();
    const operatorDir = makeProjectTempDir();
    const tokenPath = join(operatorDir, "scope-authority-token.json");
    writeFileSync(tokenPath, JSON.stringify({ schema: 1, token: "a".repeat(64) }));
    try {
      symlinkSync(tokenPath, join(scopeRoot, "notes.json"));
    } catch {
      return;
    }

    expect(isProtectedScopePath("notes.json", {
      cwd: scopeRoot,
      authorityConfigPath: join(operatorDir, "config.json"),
    })).toBe(true);
  });
});
