import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getRepoWorktreeStatus,
  getRepoWorktreeStatusAsync,
} from "./repo-worktree.js";

function createNestedBareRepoWithHookConfig(scopeRoot: string): {
  bareDir: string;
  markerPath: string;
} {
  const bareDir = join(scopeRoot, "nested.git");
  const hooksDir = join(scopeRoot, "malicious-hooks");
  const markerPath = join(scopeRoot, "hook-marker");
  mkdirSync(hooksDir, { recursive: true });
  execFileSync("git", ["init", "--bare", bareDir], { cwd: scopeRoot, stdio: "ignore" });
  const hookPath = join(hooksDir, "pre-commit");
  writeFileSync(hookPath, `#!/bin/sh\necho hook-ran > ${JSON.stringify(markerPath)}\n`, "utf8");
  chmodSync(hookPath, 0o755);
  execFileSync("git", ["--git-dir", bareDir, "config", "core.hooksPath", hooksDir], {
    cwd: scopeRoot,
    stdio: "ignore",
  });
  return { bareDir, markerPath };
}

describe("repo worktree validation", () => {
  let scopeRoot: string;

  beforeEach(() => {
    scopeRoot = join(
      tmpdir(),
      `kota-worktree-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(scopeRoot, { recursive: true });
    execFileSync("git", ["init"], { cwd: scopeRoot, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Kota Tests"], { cwd: scopeRoot, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "kota@example.com"], { cwd: scopeRoot, stdio: "ignore" });
    writeFileSync(join(scopeRoot, "README.md"), "test\n");
    execFileSync("git", ["add", "README.md"], { cwd: scopeRoot, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: scopeRoot, stdio: "ignore" });
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("reports a clean tracked repository as clean", () => {
    const status = getRepoWorktreeStatus(scopeRoot);
    expect(status.available).toBe(true);
    expect(status.dirty).toBe(false);
    expect(status.trackedDirty).toBe(false);
  });

  it("reports staged and unstaged changes as dirty", () => {
    writeFileSync(join(scopeRoot, "README.md"), "changed\n");

    const status = getRepoWorktreeStatus(scopeRoot);
    expect(status.available).toBe(true);
    expect(status.dirty).toBe(true);
    expect(status.trackedDirty).toBe(true);
    expect(status.entries.some((entry) => entry.includes("README.md"))).toBe(true);
  });

  it("distinguishes untracked-only dirty from tracked dirty", () => {
    writeFileSync(join(scopeRoot, "untracked.txt"), "new file\n");

    const status = getRepoWorktreeStatus(scopeRoot);
    expect(status.dirty).toBe(true);
    expect(status.trackedDirty).toBe(false);
  });

  it("reports the same tracked and untracked state asynchronously", async () => {
    writeFileSync(join(scopeRoot, "README.md"), "changed\n");
    writeFileSync(join(scopeRoot, "untracked.txt"), "new file\n");

    const status = await getRepoWorktreeStatusAsync(scopeRoot);

    expect(status.available).toBe(true);
    expect(status.dirty).toBe(true);
    expect(status.trackedDirty).toBe(true);
    expect(status.entries).toEqual(
      expect.arrayContaining([
        expect.stringContaining("README.md"),
        expect.stringContaining("untracked.txt"),
      ]),
    );
  });

  it("rejects implicit nested bare repository discovery before hook-capable config can run", () => {
    const { bareDir, markerPath } = createNestedBareRepoWithHookConfig(scopeRoot);

    const status = getRepoWorktreeStatus(bareDir);

    expect(status.available).toBe(false);
    expect(status.summary).toContain("safe.bareRepository");
    expect(status.summary).toContain("explicit");
    expect(existsSync(markerPath)).toBe(false);
  });
});
