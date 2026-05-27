import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRepoWorktreeStatus } from "./repo-worktree.js";

function createNestedBareRepoWithHookConfig(projectDir: string): {
  bareDir: string;
  markerPath: string;
} {
  const bareDir = join(projectDir, "nested.git");
  const hooksDir = join(projectDir, "malicious-hooks");
  const markerPath = join(projectDir, "hook-marker");
  mkdirSync(hooksDir, { recursive: true });
  execFileSync("git", ["init", "--bare", bareDir], { cwd: projectDir, stdio: "ignore" });
  const hookPath = join(hooksDir, "pre-commit");
  writeFileSync(hookPath, `#!/bin/sh\necho hook-ran > ${JSON.stringify(markerPath)}\n`, "utf8");
  chmodSync(hookPath, 0o755);
  execFileSync("git", ["--git-dir", bareDir, "config", "core.hooksPath", hooksDir], {
    cwd: projectDir,
    stdio: "ignore",
  });
  return { bareDir, markerPath };
}

describe("repo worktree validation", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-worktree-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    execFileSync("git", ["init"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Kota Tests"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "kota@example.com"], { cwd: projectDir, stdio: "ignore" });
    writeFileSync(join(projectDir, "README.md"), "test\n");
    execFileSync("git", ["add", "README.md"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: projectDir, stdio: "ignore" });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("reports a clean tracked repository as clean", () => {
    const status = getRepoWorktreeStatus(projectDir);
    expect(status.available).toBe(true);
    expect(status.dirty).toBe(false);
    expect(status.trackedDirty).toBe(false);
  });

  it("reports staged and unstaged changes as dirty", () => {
    writeFileSync(join(projectDir, "README.md"), "changed\n");

    const status = getRepoWorktreeStatus(projectDir);
    expect(status.available).toBe(true);
    expect(status.dirty).toBe(true);
    expect(status.trackedDirty).toBe(true);
    expect(status.entries.some((entry) => entry.includes("README.md"))).toBe(true);
  });

  it("distinguishes untracked-only dirty from tracked dirty", () => {
    writeFileSync(join(projectDir, "untracked.txt"), "new file\n");

    const status = getRepoWorktreeStatus(projectDir);
    expect(status.dirty).toBe(true);
    expect(status.trackedDirty).toBe(false);
  });

  it("rejects implicit nested bare repository discovery before hook-capable config can run", () => {
    const { bareDir, markerPath } = createNestedBareRepoWithHookConfig(projectDir);

    const status = getRepoWorktreeStatus(bareDir);

    expect(status.available).toBe(false);
    expect(status.summary).toContain("safe.bareRepository");
    expect(status.summary).toContain("explicit");
    expect(existsSync(markerPath)).toBe(false);
  });
});
