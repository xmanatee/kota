import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isProtectedProjectPath } from "./protected-paths.js";

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

    expect(isProtectedProjectPath("secret-link.json", projectDir)).toBe(true);
    expect(isProtectedProjectPath(join(projectDir, "env-link"), projectDir)).toBe(true);
    expect(isProtectedProjectPath(join(projectDir, "runtime-link", "secrets.json"), projectDir)).toBe(true);
  });
});
