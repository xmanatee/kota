import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkCommitStageable,
  commitWorkflowChanges,
  listCommitStagePaths,
} from "./commit.js";
import {
  type CommitTestWorkspace,
  createNestedBareRepoWithHookConfig,
  makeCommitTestWorkspace,
  removeCommitTestWorkspace,
  removeFileSoon,
} from "./commit-test-support.js";

describe("commitWorkflowChanges path handling", () => {
  let workspace: CommitTestWorkspace;

  beforeEach(() => {
    workspace = makeCommitTestWorkspace();
  });

  afterEach(() => {
    removeCommitTestWorkspace(workspace);
  });

  it("does not stage gitignored files even when they appear in the worktree", () => {
    writeFileSync(join(workspace.projectDir, ".gitignore"), "ignored.log\n");
    execSync("git add .gitignore && git commit -q -m 'ignore'", {
      cwd: workspace.projectDir,
    });
    writeFileSync(join(workspace.projectDir, "ignored.log"), "noise\n");
    writeFileSync(join(workspace.projectDir, "real.txt"), "hello\n");
    writeFileSync(join(workspace.runDirPath, "commit-message.txt"), "Builder: add real");

    const result = commitWorkflowChanges(workspace.projectDir, workspace.runDirPath);
    expect(result.committed).toBe(true);

    const tree = execSync("git show --name-only --format= HEAD", {
      cwd: workspace.projectDir,
      encoding: "utf-8",
    }).trim();
    expect(tree.split("\n").sort()).toEqual(["real.txt"]);

    const status = execSync("git status --short --ignored", {
      cwd: workspace.projectDir,
      encoding: "utf-8",
    }).trim();
    expect(status).toBe("!! ignored.log");
  });

  it("returns committed=false when the only worktree residue is gitignored", () => {
    writeFileSync(join(workspace.projectDir, ".gitignore"), "noise.log\n");
    execSync("git add .gitignore && git commit -q -m 'ignore'", {
      cwd: workspace.projectDir,
    });
    writeFileSync(join(workspace.projectDir, "noise.log"), "noise\n");

    expect(commitWorkflowChanges(workspace.projectDir, workspace.runDirPath)).toEqual({
      committed: false,
      committedPaths: [],
      daemonRestartRequired: false,
    });
  });

  it("commits when the agent staged deletions with git rm (no remaining add targets)", () => {
    const removed = join(workspace.projectDir, "data", "inbox", "note.md");
    mkdirSync(join(workspace.projectDir, "data", "inbox"), { recursive: true });
    writeFileSync(removed, "idea\n");
    execSync("git add data/inbox/note.md", { cwd: workspace.projectDir });
    execSync('git commit -q -m "add note"', { cwd: workspace.projectDir });
    execSync("git rm data/inbox/note.md", { cwd: workspace.projectDir });
    writeFileSync(join(workspace.runDirPath, "commit-message.txt"), "Sort inbox: drop stale note");

    const result = commitWorkflowChanges(workspace.projectDir, workspace.runDirPath);
    expect(result.committed).toBe(true);
    if (!result.committed) throw new Error("unreachable");
    expect(result.message).toBe("Sort inbox: drop stale note");
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/);

    const tree = execSync("git show --name-status --format= HEAD", {
      cwd: workspace.projectDir,
      encoding: "utf-8",
    }).trim();
    expect(tree).toBe("D\tdata/inbox/note.md");
  });

  it("retries path-only commit when a transient Git index lock clears", () => {
    const removed = join(workspace.projectDir, "data", "inbox", "note.md");
    mkdirSync(join(workspace.projectDir, "data", "inbox"), { recursive: true });
    writeFileSync(removed, "idea\n");
    execSync("git add data/inbox/note.md", { cwd: workspace.projectDir });
    execSync('git commit -q -m "add note"', { cwd: workspace.projectDir });
    execSync("git rm data/inbox/note.md", { cwd: workspace.projectDir });
    writeFileSync(join(workspace.runDirPath, "commit-message.txt"), "Sort inbox: drop stale note");
    const lockPath = join(workspace.projectDir, ".git", "index.lock");
    writeFileSync(lockPath, "busy\n");
    removeFileSoon(lockPath, 150);

    const result = commitWorkflowChanges(workspace.projectDir, workspace.runDirPath);

    expect(result.committed).toBe(true);
    const tree = execSync("git show --name-status --format= HEAD", {
      cwd: workspace.projectDir,
      encoding: "utf-8",
    }).trim();
    expect(tree).toBe("D\tdata/inbox/note.md");
  });

  it("commits mixed staged deletions plus unstaged additions in one commit", () => {
    const original = join(workspace.projectDir, "data", "inbox", "raw.md");
    mkdirSync(join(workspace.projectDir, "data", "inbox"), { recursive: true });
    writeFileSync(original, "raw\n");
    execSync("git add data/inbox/raw.md", { cwd: workspace.projectDir });
    execSync('git commit -q -m "add raw"', { cwd: workspace.projectDir });
    execSync("git rm data/inbox/raw.md", { cwd: workspace.projectDir });
    const normalized = join(workspace.projectDir, "data", "tasks", "task-raw.md");
    mkdirSync(join(workspace.projectDir, "data", "tasks"), { recursive: true });
    writeFileSync(normalized, "normalized\n");
    writeFileSync(join(workspace.runDirPath, "commit-message.txt"), "Sort inbox: graduate raw capture");

    const result = commitWorkflowChanges(workspace.projectDir, workspace.runDirPath);
    expect(result.committed).toBe(true);

    const tree = execSync("git show --name-status --format= HEAD", {
      cwd: workspace.projectDir,
      encoding: "utf-8",
    })
      .trim()
      .split("\n")
      .sort();
    expect(tree).toEqual([
      "A\tdata/tasks/task-raw.md",
      "D\tdata/inbox/raw.md",
    ]);
  });

  it("commits both sides of a staged task move without leaving the source deletion staged", () => {
    const source = join(workspace.projectDir, "data", "tasks", "ready", "task-move.md");
    mkdirSync(join(workspace.projectDir, "data", "tasks", "ready"), { recursive: true });
    mkdirSync(join(workspace.projectDir, "data", "tasks", "done"), { recursive: true });
    writeFileSync(source, "task\n");
    execSync("git add data/tasks/ready/task-move.md", { cwd: workspace.projectDir });
    execSync('git commit -q -m "add task"', { cwd: workspace.projectDir });
    execSync("git mv data/tasks/ready/task-move.md data/tasks/done/task-move.md", {
      cwd: workspace.projectDir,
    });
    writeFileSync(join(workspace.runDirPath, "commit-message.txt"), "Builder: finish task move");

    const result = commitWorkflowChanges(workspace.projectDir, workspace.runDirPath);
    expect(result.committed).toBe(true);

    const tree = execSync("git show --name-status --format= --no-renames HEAD", {
      cwd: workspace.projectDir,
      encoding: "utf-8",
    })
      .trim()
      .split("\n")
      .sort();
    expect(tree).toEqual([
      "A\tdata/tasks/done/task-move.md",
      "D\tdata/tasks/ready/task-move.md",
    ]);
    const status = execSync("git status --short", {
      cwd: workspace.projectDir,
      encoding: "utf-8",
    }).trim();
    expect(status).toBe("");
  });

  it("rejects registered scratch worktrees before committing", () => {
    writeFileSync(join(workspace.projectDir, "change.txt"), "hello\n");
    writeFileSync(join(workspace.runDirPath, "commit-message.txt"), "Builder: change");
    mkdirSync(join(workspace.projectDir, ".claude", "worktrees"), { recursive: true });
    execSync("git worktree add .claude/worktrees/scratch -b scratch", {
      cwd: workspace.projectDir,
    });

    expect(() => commitWorkflowChanges(workspace.projectDir, workspace.runDirPath)).toThrow(
      "Registered scratch worktrees must be merged or removed before committing",
    );
  });
});

describe("checkCommitStageable", () => {
  let workspace: CommitTestWorkspace;

  beforeEach(() => {
    workspace = makeCommitTestWorkspace();
  });

  afterEach(() => {
    removeCommitTestWorkspace(workspace);
  });

  it("passes when there is nothing to stage", () => {
    expect(checkCommitStageable(workspace.projectDir)).toMatch(/no mutated paths to stage/);
  });

  it("passes when every mutated path is stageable", () => {
    writeFileSync(join(workspace.projectDir, "change.txt"), "hello\n");
    expect(checkCommitStageable(workspace.projectDir)).toMatch(/1 mutated path\(s\) stageable/);
    expect(listCommitStagePaths(workspace.projectDir)).toEqual(["change.txt"]);
  });

  it("passes when mutated paths are tracked deletions", () => {
    const tracked = join(workspace.projectDir, "data", "note.md");
    mkdirSync(join(workspace.projectDir, "data"), { recursive: true });
    writeFileSync(tracked, "idea\n");
    execSync("git add data/note.md", { cwd: workspace.projectDir });
    execSync('git commit -q -m "add"', { cwd: workspace.projectDir });
    rmSync(tracked);
    expect(checkCommitStageable(workspace.projectDir)).toMatch(/1 mutated path\(s\) stageable/);
  });

  it("rejects implicit nested bare repository discovery before hook-capable config can run", () => {
    const { bareDir, markerPath } = createNestedBareRepoWithHookConfig(workspace.projectDir);

    expect(() => checkCommitStageable(bareDir)).toThrow(/safe\.bareRepository/);
    expect(existsSync(markerPath)).toBe(false);
  });
});
