import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertRepoWorktreeClean,
  getRepoWorktreeStatus,
} from "./repo-worktree.js";

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
    expect(() => assertRepoWorktreeClean(projectDir)).not.toThrow();
  });

  it("reports staged and unstaged changes as dirty", () => {
    writeFileSync(join(projectDir, "README.md"), "changed\n");

    const status = getRepoWorktreeStatus(projectDir);
    expect(status.available).toBe(true);
    expect(status.dirty).toBe(true);
    expect(status.trackedDirty).toBe(true);
    expect(status.entries.some((entry) => entry.includes("README.md"))).toBe(true);
    expect(() => assertRepoWorktreeClean(projectDir)).toThrow(
      /Repository worktree must be clean before starting a new autonomous run/,
    );
  });

  it("distinguishes untracked-only dirty from tracked dirty", () => {
    writeFileSync(join(projectDir, "untracked.txt"), "new file\n");

    const status = getRepoWorktreeStatus(projectDir);
    expect(status.dirty).toBe(true);
    expect(status.trackedDirty).toBe(false);
  });
});
