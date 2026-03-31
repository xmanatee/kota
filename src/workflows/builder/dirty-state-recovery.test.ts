import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autoResetDirtyWorktree } from "./dirty-state-recovery.js";

function initGitRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  execSync("git init", { cwd: dir, stdio: "ignore" });
  execSync("git config user.name 'Test'", { cwd: dir, stdio: "ignore" });
  execSync("git config user.email 'test@example.com'", { cwd: dir, stdio: "ignore" });
  writeFileSync(join(dir, "README.md"), "init\n");
  writeFileSync(join(dir, ".gitignore"), ".kota/\n");
  execSync("git add .", { cwd: dir, stdio: "ignore" });
  execSync("git commit -m init", { cwd: dir, stdio: "ignore" });
}

function gitStatus(dir: string): string {
  return execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: dir,
    encoding: "utf8",
  }).trim();
}

describe("autoResetDirtyWorktree", () => {
  let projectDir: string;
  let warned: string[];

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-dirty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    initGitRepo(projectDir);
    warned = [];
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("is a no-op when the worktree is already clean", () => {
    const warn = vi.fn();
    autoResetDirtyWorktree(projectDir, warn);
    expect(warn).not.toHaveBeenCalled();
    expect(gitStatus(projectDir)).toBe("");
  });

  it("moves stranded doing tasks to ready/ and resets when dirty", () => {
    // Make the worktree dirty
    writeFileSync(join(projectDir, "README.md"), "changed\n");
    // Add a stranded doing task (left by a timed-out builder run)
    mkdirSync(join(projectDir, "tasks", "doing"), { recursive: true });
    mkdirSync(join(projectDir, "tasks", "ready"), { recursive: true });
    writeFileSync(
      join(projectDir, "tasks", "doing", "task-active.md"),
      "---\nid: task-active\ntitle: Active\nstatus: doing\n---\n",
    );

    const warn = vi.fn();
    autoResetDirtyWorktree(projectDir, warn);

    // Should have warned about the dirty state and the task move
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain("README.md");
    expect(warn.mock.calls[1][0]).toContain("task-active.md");
    // Doing task moved to ready/ with status updated to "ready"
    expect(existsSync(join(projectDir, "tasks", "ready", "task-active.md"))).toBe(true);
    expect(existsSync(join(projectDir, "tasks", "doing", "task-active.md"))).toBe(false);
    const rescuedContent = readFileSync(
      join(projectDir, "tasks", "ready", "task-active.md"),
      "utf8",
    );
    expect(rescuedContent).toContain("status: ready");
    expect(rescuedContent).not.toContain("status: doing");
    // Original dirty state is reset; only the re-queued task in ready/ remains
    expect(gitStatus(projectDir)).not.toContain("README.md");
    expect(gitStatus(projectDir)).toContain("tasks/ready/task-active.md");
  });

  it("auto-resets tracked modifications when dirty with no doing tasks", () => {
    writeFileSync(join(projectDir, "README.md"), "changed\n");
    expect(gitStatus(projectDir)).not.toBe("");

    const warn = vi.fn();
    autoResetDirtyWorktree(projectDir, warn);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("README.md");
    expect(gitStatus(projectDir)).toBe("");
  });

  it("auto-resets untracked new files when dirty with no doing tasks", () => {
    writeFileSync(join(projectDir, "new-file.ts"), "// leftover\n");
    expect(gitStatus(projectDir)).not.toBe("");

    const warn = vi.fn();
    autoResetDirtyWorktree(projectDir, warn);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("new-file.ts");
    expect(gitStatus(projectDir)).toBe("");
  });

  it("preserves .kota/ run directories (they are gitignored)", () => {
    // .kota/ is in .gitignore so git clean -fd will not touch it
    mkdirSync(join(projectDir, ".kota", "runs", "run-1"), { recursive: true });
    writeFileSync(join(projectDir, ".kota", "runs", "run-1", "metadata.json"), "{}");
    writeFileSync(join(projectDir, "new-file.ts"), "// leftover\n");

    autoResetDirtyWorktree(projectDir, (msg) => warned.push(msg));

    // Dirty source files are gone
    expect(gitStatus(projectDir)).toBe("");
    // .kota/ run artifacts are preserved
    expect(existsSync(join(projectDir, ".kota", "runs", "run-1", "metadata.json"))).toBe(true);
  });
});
