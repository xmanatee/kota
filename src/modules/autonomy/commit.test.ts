import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowStepContext, WorkflowStepResult } from "#core/workflow/run-types.js";
import { commitWorkflowChanges } from "./commit.js";
import builderWorkflow from "./workflows/builder/workflow.js";

function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "init\n");
  execSync("git add README.md", { cwd: dir });
  execSync('git commit -m "init"', { cwd: dir });
}

function makeStepResult(status: WorkflowStepResult["status"]): WorkflowStepResult {
  return { id: "", type: "tool", status, startedAt: "", completedAt: "", durationMs: 0 };
}

function makeContext(
  stepResults: Record<string, WorkflowStepResult["status"]>,
  stepOutputs: Record<string, unknown> = {},
): WorkflowStepContext {
  const results: Record<string, WorkflowStepResult> = {};
  for (const [id, status] of Object.entries(stepResults)) {
    results[id] = makeStepResult(status);
  }
  return {
    stepResults: results,
    stepOutputs,
    previousOutput: undefined,
    stepOutputList: [],
    projectDir: "/tmp",
    workflow: { name: "builder", definitionPath: "", runId: "", runDir: "", runDirPath: "" },
    trigger: { event: "", payload: {} },
    runTool: async () => ({ content: [] }),
    emit: () => {},
    requestRestart: () => {},
    readPrompt: () => "",
    readRuntimeState: () => ({ completedRuns: 0, pendingRuns: [], workflows: {} }),
  } as unknown as WorkflowStepContext;
}

describe("commitWorkflowChanges", () => {
  let tmpBase: string;
  let projectDir: string;
  let runDirPath: string;

  beforeEach(() => {
    tmpBase = join(
      tmpdir(),
      `kota-commit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    projectDir = join(tmpBase, "project");
    runDirPath = join(tmpBase, "run");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(runDirPath, { recursive: true });
    initGitRepo(projectDir);
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("returns committed=false when there are no working tree changes", () => {
    expect(commitWorkflowChanges(projectDir, runDirPath)).toEqual({ committed: false });
  });

  it("commits unstaged working tree changes using the commit-message.txt file", () => {
    writeFileSync(join(projectDir, "change.txt"), "hello\n");
    writeFileSync(join(runDirPath, "commit-message.txt"), "Builder: my custom message");

    const result = commitWorkflowChanges(projectDir, runDirPath);
    expect(result).toEqual({ committed: true, message: "Builder: my custom message" });

    const log = execSync("git log --format=%s -1", {
      cwd: projectDir,
      encoding: "utf-8",
    }).trim();
    expect(log).toBe("Builder: my custom message");
  });

  it("requires commit-message.txt when there are working tree changes", () => {
    writeFileSync(join(projectDir, "change.txt"), "hello\n");

    expect(() => commitWorkflowChanges(projectDir, runDirPath)).toThrow(
      "Missing required workflow commit message",
    );

    const stagedFiles = execSync("git diff --cached --name-only", {
      cwd: projectDir,
      encoding: "utf-8",
    }).trim();
    expect(stagedFiles).toBe("");
  });

  it("rejects an empty commit message before staging changes", () => {
    writeFileSync(join(projectDir, "change.txt"), "hello\n");
    writeFileSync(join(runDirPath, "commit-message.txt"), "");

    expect(() => commitWorkflowChanges(projectDir, runDirPath)).toThrow(
      "Workflow commit message must not be empty",
    );

    const stagedFiles = execSync("git diff --cached --name-only", {
      cwd: projectDir,
      encoding: "utf-8",
    }).trim();
    expect(stagedFiles).toBe("");

    const status = execSync("git status --short", {
      cwd: projectDir,
      encoding: "utf-8",
    }).trim();
    expect(status).toBe("?? change.txt");
  });

  it("stages and commits untracked files swept in by listWorkflowMutatedPaths", () => {
    const untracked = join(projectDir, "data", "notes", "new.md");
    mkdirSync(join(projectDir, "data", "notes"), { recursive: true });
    writeFileSync(untracked, "new\n");
    writeFileSync(join(runDirPath, "commit-message.txt"), "Builder: add note");

    const result = commitWorkflowChanges(projectDir, runDirPath);
    expect(result.committed).toBe(true);

    const tree = execSync("git show --name-only --format= HEAD", {
      cwd: projectDir,
      encoding: "utf-8",
    }).trim();
    expect(tree).toBe("data/notes/new.md");
  });

  it("does not stage gitignored files even when they appear in the worktree", () => {
    writeFileSync(join(projectDir, ".gitignore"), "ignored.log\n");
    execSync("git add .gitignore && git commit -q -m 'ignore'", {
      cwd: projectDir,
    });
    writeFileSync(join(projectDir, "ignored.log"), "noise\n");
    writeFileSync(join(projectDir, "real.txt"), "hello\n");
    writeFileSync(join(runDirPath, "commit-message.txt"), "Builder: add real");

    const result = commitWorkflowChanges(projectDir, runDirPath);
    expect(result.committed).toBe(true);

    const tree = execSync("git show --name-only --format= HEAD", {
      cwd: projectDir,
      encoding: "utf-8",
    }).trim();
    expect(tree.split("\n").sort()).toEqual(["real.txt"]);

    const status = execSync("git status --short --ignored", {
      cwd: projectDir,
      encoding: "utf-8",
    }).trim();
    expect(status).toBe("!! ignored.log");
  });

  it("returns committed=false when the only worktree residue is gitignored", () => {
    writeFileSync(join(projectDir, ".gitignore"), "noise.log\n");
    execSync("git add .gitignore && git commit -q -m 'ignore'", {
      cwd: projectDir,
    });
    writeFileSync(join(projectDir, "noise.log"), "noise\n");

    expect(commitWorkflowChanges(projectDir, runDirPath)).toEqual({
      committed: false,
    });
  });

  it("commits when the agent staged deletions with git rm (no remaining add targets)", () => {
    const removed = join(projectDir, "data", "inbox", "note.md");
    mkdirSync(join(projectDir, "data", "inbox"), { recursive: true });
    writeFileSync(removed, "idea\n");
    execSync("git add data/inbox/note.md", { cwd: projectDir });
    execSync('git commit -q -m "add note"', { cwd: projectDir });
    execSync("git rm data/inbox/note.md", { cwd: projectDir });
    writeFileSync(join(runDirPath, "commit-message.txt"), "Sort inbox: drop stale note");

    const result = commitWorkflowChanges(projectDir, runDirPath);
    expect(result).toEqual({ committed: true, message: "Sort inbox: drop stale note" });

    const tree = execSync("git show --name-status --format= HEAD", {
      cwd: projectDir,
      encoding: "utf-8",
    }).trim();
    expect(tree).toBe("D\tdata/inbox/note.md");
  });

  it("commits mixed staged deletions plus unstaged additions in one commit", () => {
    const original = join(projectDir, "data", "inbox", "raw.md");
    mkdirSync(join(projectDir, "data", "inbox"), { recursive: true });
    writeFileSync(original, "raw\n");
    execSync("git add data/inbox/raw.md", { cwd: projectDir });
    execSync('git commit -q -m "add raw"', { cwd: projectDir });
    execSync("git rm data/inbox/raw.md", { cwd: projectDir });
    const normalized = join(projectDir, "data", "tasks", "task-raw.md");
    mkdirSync(join(projectDir, "data", "tasks"), { recursive: true });
    writeFileSync(normalized, "normalized\n");
    writeFileSync(join(runDirPath, "commit-message.txt"), "Sort inbox: graduate raw capture");

    const result = commitWorkflowChanges(projectDir, runDirPath);
    expect(result.committed).toBe(true);

    const tree = execSync("git show --name-status --format= HEAD", {
      cwd: projectDir,
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

  it("rejects registered scratch worktrees before committing", () => {
    writeFileSync(join(projectDir, "change.txt"), "hello\n");
    writeFileSync(join(runDirPath, "commit-message.txt"), "Builder: change");
    mkdirSync(join(projectDir, ".claude", "worktrees"), { recursive: true });
    execSync("git worktree add .claude/worktrees/scratch -b scratch", { cwd: projectDir });

    expect(() => commitWorkflowChanges(projectDir, runDirPath)).toThrow(
      "Registered scratch worktrees must be merged or removed before committing",
    );
  });
});

describe("builder workflow commit and restart gates", () => {
  const commitStep = builderWorkflow.steps.find((s) => s.id === "commit");
  const restartStep = builderWorkflow.steps.find((s) => s.id === "request-restart");

  it("commit step exists in the workflow", () => {
    expect(commitStep).toBeDefined();
    expect(commitStep?.when).toBeDefined();
  });

  it("restart step exists in the workflow", () => {
    expect(restartStep).toBeDefined();
    expect(restartStep?.when).toBeDefined();
  });

  it("skips commit when build fails", async () => {
    const ctx = makeContext({
      build: "failed",
      "check-no-intermediate-commits": "skipped",
    });
    expect(await commitStep!.when!(ctx)).toBe(false);
  });

  it("runs commit when build passes and no intermediate commits", async () => {
    const ctx = makeContext({
      build: "success",
      "check-no-intermediate-commits": "success",
      "create-task-branch": "success",
    });
    expect(await commitStep!.when!(ctx)).toBe(true);
  });

  it("skips restart when commit produced no commit", async () => {
    const ctx = makeContext(
      { commit: "success" },
      { commit: { committed: false } },
    );
    expect(await restartStep!.when!(ctx)).toBe(false);
  });

  it("runs restart when commit produced a commit", async () => {
    const ctx = makeContext(
      { commit: "success" },
      { commit: { committed: true, message: "Workflow: update repo" } },
    );
    expect(await restartStep!.when!(ctx)).toBe(true);
  });
});
