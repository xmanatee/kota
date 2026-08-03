import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkCommitStageable,
  commitWorkflowChanges,
  listCommitStagePaths,
} from "./commit.js";
import {
  type CommitTestWorkspace,
  makeCommitTestWorkspace,
  removeCommitTestWorkspace,
  removeFileSoon,
} from "./commit-test-support.js";
import { checkCommitMessageExists } from "./shared.js";

describe("commitWorkflowChanges", () => {
  let workspace: CommitTestWorkspace;

  beforeEach(() => {
    workspace = makeCommitTestWorkspace();
  });

  afterEach(() => {
    removeCommitTestWorkspace(workspace);
  });

  it("returns committed=false when there are no working tree changes", () => {
    expect(commitWorkflowChanges(workspace.projectDir, workspace.runDirPath)).toEqual({
      committed: false,
      committedPaths: [],
      daemonRestartRequired: false,
    });
  });

  it("commits unstaged working tree changes using the commit-message.txt file", () => {
    writeFileSync(join(workspace.projectDir, "change.txt"), "hello\n");
    writeFileSync(join(workspace.runDirPath, "commit-message.txt"), "Builder: my custom message");

    const result = commitWorkflowChanges(workspace.projectDir, workspace.runDirPath);
    expect(result.committed).toBe(true);
    if (!result.committed) throw new Error("unreachable");
    expect(result.message).toBe("Builder: my custom message");
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.committedPaths).toEqual(["change.txt"]);
    expect(result.daemonRestartRequired).toBe(true);

    const log = execSync("git log --format=%s -1", {
      cwd: workspace.projectDir,
      encoding: "utf-8",
    }).trim();
    expect(log).toBe("Builder: my custom message");

    const headSha = execSync("git rev-parse HEAD", {
      cwd: workspace.projectDir,
      encoding: "utf-8",
    }).trim();
    expect(result.sha).toBe(headSha);
  });

  it("does not require a daemon restart for task-state-only commits", () => {
    const taskPath = join(workspace.projectDir, "data", "tasks", "ready", "task-one.md");
    mkdirSync(join(workspace.projectDir, "data", "tasks", "ready"), { recursive: true });
    writeFileSync(taskPath, "---\nid: task-one\n---\n");
    writeFileSync(join(workspace.runDirPath, "commit-message.txt"), "Add task");

    const result = commitWorkflowChanges(workspace.projectDir, workspace.runDirPath);

    expect(result).toMatchObject({
      committed: true,
      committedPaths: ["data/tasks/ready/task-one.md"],
      daemonRestartRequired: false,
    });
  });

  it("retries staging when a transient Git index lock clears", () => {
    writeFileSync(join(workspace.projectDir, "change.txt"), "hello\n");
    writeFileSync(join(workspace.runDirPath, "commit-message.txt"), "Builder: my custom message");
    const lockPath = join(workspace.projectDir, ".git", "index.lock");
    writeFileSync(lockPath, "busy\n");
    removeFileSoon(lockPath, 150);

    const result = commitWorkflowChanges(workspace.projectDir, workspace.runDirPath);

    expect(result.committed).toBe(true);
    const tree = execSync("git show --name-only --format= HEAD", {
      cwd: workspace.projectDir,
      encoding: "utf-8",
    }).trim();
    expect(tree).toBe("change.txt");
  });

  it("repair check retries staging when a transient Git index lock clears", () => {
    writeFileSync(join(workspace.projectDir, "change.txt"), "hello\n");
    const lockPath = join(workspace.projectDir, ".git", "index.lock");
    writeFileSync(lockPath, "busy\n");
    removeFileSoon(lockPath, 150);

    expect(checkCommitStageable(workspace.projectDir)).toBe(
      "OK: 1 mutated path(s) stageable",
    );
  });

  it("repair check skips redundant staging when mutated paths are already staged", () => {
    writeFileSync(join(workspace.projectDir, "change.txt"), "hello\n");
    execSync("git add change.txt", { cwd: workspace.projectDir });
    const lockPath = join(workspace.projectDir, ".git", "index.lock");
    writeFileSync(lockPath, "busy\n");

    expect(checkCommitStageable(workspace.projectDir)).toBe(
      "OK: 1 mutated path(s) already staged",
    );
  });

  it("requires commit-message.txt when there are working tree changes", () => {
    writeFileSync(join(workspace.projectDir, "change.txt"), "hello\n");

    expect(() => commitWorkflowChanges(workspace.projectDir, workspace.runDirPath)).toThrow(
      "Missing required workflow commit message",
    );

    const stagedFiles = execSync("git diff --cached --name-only", {
      cwd: workspace.projectDir,
      encoding: "utf-8",
    }).trim();
    expect(stagedFiles).toBe("");
  });

  it("repair check requires commit-message.txt for unstaged working tree changes", () => {
    writeFileSync(join(workspace.projectDir, "change.txt"), "hello\n");

    expect(() => checkCommitMessageExists(workspace.runDirPath, workspace.projectDir)).toThrow(
      `Missing required workflow commit message: ${join(workspace.runDirPath, "commit-message.txt")}`,
    );
  });

  it("repair check ignores gitignored residue when deciding whether a message is required", () => {
    writeFileSync(join(workspace.projectDir, ".gitignore"), "ignored.log\n");
    execSync("git add .gitignore && git commit -q -m 'ignore'", {
      cwd: workspace.projectDir,
    });
    writeFileSync(join(workspace.projectDir, "ignored.log"), "noise\n");

    expect(checkCommitMessageExists(workspace.runDirPath, workspace.projectDir)).toBe(
      "OK: no mutated paths — commit message not required",
    );
  });

  it("rejects an empty commit message before staging changes", () => {
    writeFileSync(join(workspace.projectDir, "change.txt"), "hello\n");
    writeFileSync(join(workspace.runDirPath, "commit-message.txt"), "");

    expect(() => commitWorkflowChanges(workspace.projectDir, workspace.runDirPath)).toThrow(
      "Workflow commit message must not be empty",
    );

    const stagedFiles = execSync("git diff --cached --name-only", {
      cwd: workspace.projectDir,
      encoding: "utf-8",
    }).trim();
    expect(stagedFiles).toBe("");

    const status = execSync("git status --short", {
      cwd: workspace.projectDir,
      encoding: "utf-8",
    }).trim();
    expect(status).toBe("?? change.txt");
  });

  it("stages and commits untracked files swept in by listWorkflowMutatedPaths", () => {
    const untracked = join(workspace.projectDir, "data", "notes", "new.md");
    mkdirSync(join(workspace.projectDir, "data", "notes"), { recursive: true });
    writeFileSync(untracked, "new\n");
    writeFileSync(join(workspace.runDirPath, "commit-message.txt"), "Builder: add note");

    const result = commitWorkflowChanges(workspace.projectDir, workspace.runDirPath);
    expect(result.committed).toBe(true);

    const tree = execSync("git show --name-only --format= HEAD", {
      cwd: workspace.projectDir,
      encoding: "utf-8",
    }).trim();
    expect(tree).toBe("data/notes/new.md");
  });

  it("commits only paths mutated after the supplied baseline", () => {
    writeFileSync(join(workspace.projectDir, "README.md"), "pre-existing dirty work\n");
    const baselineMutatedPaths = listCommitStagePaths(workspace.projectDir);
    const taskPath = join(workspace.projectDir, "data", "tasks", "ready", "task-security.md");
    mkdirSync(join(workspace.projectDir, "data", "tasks", "ready"), { recursive: true });
    writeFileSync(taskPath, "security task\n");
    writeFileSync(join(workspace.runDirPath, "commit-message.txt"), "security-review: create task");

    const policy = {
      kind: "paths-mutated-since-baseline" as const,
      baselineMutatedPaths,
    };
    expect(listCommitStagePaths(workspace.projectDir, policy)).toEqual([
      "data/tasks/ready/task-security.md",
    ]);
    expect(checkCommitStageable(workspace.projectDir, policy)).toMatch(/1 mutated path\(s\) stageable/);
    const result = commitWorkflowChanges(workspace.projectDir, workspace.runDirPath, policy);

    expect(result.committed).toBe(true);
    const tree = execSync("git show --name-only --format= HEAD", {
      cwd: workspace.projectDir,
      encoding: "utf-8",
    }).trim();
    expect(tree).toBe("data/tasks/ready/task-security.md");
    const status = execSync("git status --short -- README.md", {
      cwd: workspace.projectDir,
      encoding: "utf-8",
    }).trim();
    expect(status).toBe("M README.md");
  });

  it("does not commit pre-existing staged paths filtered out by the baseline", () => {
    writeFileSync(join(workspace.projectDir, "README.md"), "pre-existing staged work\n");
    execSync("git add README.md", { cwd: workspace.projectDir });
    const baselineMutatedPaths = listCommitStagePaths(workspace.projectDir);
    const taskPath = join(workspace.projectDir, "data", "tasks", "ready", "task-security.md");
    mkdirSync(join(workspace.projectDir, "data", "tasks", "ready"), { recursive: true });
    writeFileSync(taskPath, "security task\n");
    writeFileSync(join(workspace.runDirPath, "commit-message.txt"), "security-review: create task");

    const result = commitWorkflowChanges(workspace.projectDir, workspace.runDirPath, {
      kind: "paths-mutated-since-baseline",
      baselineMutatedPaths,
    });

    expect(result.committed).toBe(true);
    const tree = execSync("git show --name-only --format= HEAD", {
      cwd: workspace.projectDir,
      encoding: "utf-8",
    }).trim();
    expect(tree).toBe("data/tasks/ready/task-security.md");
    const stillStaged = execSync("git diff --cached --name-only", {
      cwd: workspace.projectDir,
      encoding: "utf-8",
    }).trim();
    expect(stillStaged).toBe("README.md");
  });
});
