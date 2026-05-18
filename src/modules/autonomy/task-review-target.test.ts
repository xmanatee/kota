import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findTaskReviewTarget } from "./task-review-target.js";

const tempDirs: string[] = [];

function makeGitProject(): string {
  const dir = join(tmpdir(), `kota-task-review-target-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "test"], {
    cwd: dir,
    stdio: "ignore",
  });
  tempDirs.push(dir);
  return dir;
}

function writeTask(
  projectDir: string,
  state: "backlog" | "blocked" | "done" | "doing" | "ready",
  id: string,
  title: string,
): void {
  const taskDir = join(projectDir, "data/tasks", state);
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(
    join(taskDir, `${id}.md`),
    [
      "---",
      `id: ${id}`,
      `title: ${title}`,
      `status: ${state}`,
      "---",
      "",
      "## Done When",
      "",
      "- Done.",
      "",
    ].join("\n"),
  );
}

describe("findTaskReviewTarget", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reviews a staged done task before collateral blocked task edits", () => {
    const projectDir = makeGitProject();
    writeTask(projectDir, "blocked", "task-collateral-blocker", "Collateral blocker");
    writeTask(projectDir, "done", "task-implemented-work", "Implemented work");
    execFileSync("git", ["add", "data/tasks/blocked", "data/tasks/done"], {
      cwd: projectDir,
      stdio: "ignore",
    });

    expect(findTaskReviewTarget(projectDir)).toMatchObject({
      path: "data/tasks/done/task-implemented-work.md",
      state: "done",
    });
  });

  it("reviews a staged ready-to-done move before collateral blocked edits", () => {
    const projectDir = makeGitProject();
    writeTask(projectDir, "ready", "task-implemented-work", "Implemented work");
    writeTask(projectDir, "blocked", "task-collateral-blocker", "Collateral blocker");
    execFileSync("git", ["add", "data/tasks"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: projectDir, stdio: "ignore" });

    mkdirSync(join(projectDir, "data/tasks/done"), { recursive: true });
    renameSync(
      join(projectDir, "data/tasks/ready/task-implemented-work.md"),
      join(projectDir, "data/tasks/done/task-implemented-work.md"),
    );
    writeTask(projectDir, "done", "task-implemented-work", "Implemented work");
    writeTask(
      projectDir,
      "blocked",
      "task-collateral-blocker",
      "Collateral blocker dependency note",
    );
    execFileSync("git", ["add", "data/tasks"], { cwd: projectDir, stdio: "ignore" });

    expect(findTaskReviewTarget(projectDir)).toMatchObject({
      path: "data/tasks/done/task-implemented-work.md",
      state: "done",
    });
  });

  it("reviews a staged blocked task when there is no staged done task", () => {
    const projectDir = makeGitProject();
    writeTask(projectDir, "blocked", "task-real-blocker", "Real blocker");
    execFileSync("git", ["add", "data/tasks/blocked"], { cwd: projectDir, stdio: "ignore" });

    expect(findTaskReviewTarget(projectDir)).toMatchObject({
      path: "data/tasks/blocked/task-real-blocker.md",
      state: "blocked",
    });
  });

  it("reviews an active doing task before staged terminal-state tasks", () => {
    const projectDir = makeGitProject();
    writeTask(projectDir, "doing", "task-active", "Active work");
    writeTask(projectDir, "done", "task-implemented-work", "Implemented work");
    execFileSync("git", ["add", "data/tasks/done"], { cwd: projectDir, stdio: "ignore" });

    expect(findTaskReviewTarget(projectDir)).toMatchObject({
      path: "data/tasks/doing/task-active.md",
      state: "doing",
    });
  });
});
