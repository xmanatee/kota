import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import { createWorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import {
  findExpectedTaskReviewTarget,
  findTaskReviewTarget,
  readTaskReviewMutationStatus,
} from "./task-review-target.js";

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
  execFileSync("git", ["commit", "--allow-empty", "-m", "initial"], {
    cwd: dir,
    stdio: "ignore",
  });
  tempDirs.push(dir);
  return dir;
}

function writeTask(
  workspaceRoot: string,
  state: "backlog" | "blocked" | "done" | "doing" | "ready",
  id: string,
  title: string,
): void {
  const taskDir = join(workspaceRoot, "data/tasks", state);
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

async function findReviewTarget(workspaceRoot: string) {
  const runCommand = createWorkflowCommandRunner({ cwd: workspaceRoot });
  const mutationStatus = await readTaskReviewMutationStatus(
    workspaceRoot,
    runCommand,
  );
  return findTaskReviewTarget(workspaceRoot, mutationStatus);
}

describe("findTaskReviewTarget", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reviews a staged done task before collateral blocked task edits", async () => {
    const workspaceRoot = makeGitProject();
    writeTask(workspaceRoot, "blocked", "task-collateral-blocker", "Collateral blocker");
    writeTask(workspaceRoot, "done", "task-implemented-work", "Implemented work");
    execFileSync("git", ["add", "data/tasks/blocked", "data/tasks/done"], {
      cwd: workspaceRoot,
      stdio: "ignore",
    });

    expect(await findReviewTarget(workspaceRoot)).toMatchObject({
      path: "data/tasks/done/task-implemented-work.md",
      state: "done",
    });
  });

  it("reviews a staged ready-to-done move before collateral blocked edits", async () => {
    const workspaceRoot = makeGitProject();
    writeTask(workspaceRoot, "ready", "task-implemented-work", "Implemented work");
    writeTask(workspaceRoot, "blocked", "task-collateral-blocker", "Collateral blocker");
    execFileSync("git", ["add", "data/tasks"], { cwd: workspaceRoot, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: workspaceRoot, stdio: "ignore" });

    mkdirSync(join(workspaceRoot, "data/tasks/done"), { recursive: true });
    renameSync(
      join(workspaceRoot, "data/tasks/ready/task-implemented-work.md"),
      join(workspaceRoot, "data/tasks/done/task-implemented-work.md"),
    );
    writeTask(workspaceRoot, "done", "task-implemented-work", "Implemented work");
    writeTask(
      workspaceRoot,
      "blocked",
      "task-collateral-blocker",
      "Collateral blocker dependency note",
    );
    execFileSync("git", ["add", "data/tasks"], { cwd: workspaceRoot, stdio: "ignore" });

    expect(await findReviewTarget(workspaceRoot)).toMatchObject({
      path: "data/tasks/done/task-implemented-work.md",
      state: "done",
    });
  });

  it("reviews a staged blocked task when there is no staged done task", async () => {
    const workspaceRoot = makeGitProject();
    writeTask(workspaceRoot, "blocked", "task-real-blocker", "Real blocker");
    execFileSync("git", ["add", "data/tasks/blocked"], { cwd: workspaceRoot, stdio: "ignore" });

    expect(await findReviewTarget(workspaceRoot)).toMatchObject({
      path: "data/tasks/blocked/task-real-blocker.md",
      state: "blocked",
    });
  });

  it("reviews an active doing task before staged terminal-state tasks", async () => {
    const workspaceRoot = makeGitProject();
    writeTask(workspaceRoot, "doing", "task-active", "Active work");
    writeTask(workspaceRoot, "done", "task-implemented-work", "Implemented work");
    execFileSync("git", ["add", "data/tasks/done"], { cwd: workspaceRoot, stdio: "ignore" });

    expect(await findReviewTarget(workspaceRoot)).toMatchObject({
      path: "data/tasks/doing/task-active.md",
      state: "doing",
    });
  });

  it("finds the expected task after an unstaged doing-to-done move", () => {
    const workspaceRoot = makeGitProject();
    writeTask(workspaceRoot, "doing", "task-alpha", "Concurrent alpha work");
    writeTask(workspaceRoot, "doing", "task-target", "Target work");
    execFileSync("git", ["add", "data/tasks/doing"], { cwd: workspaceRoot, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: workspaceRoot, stdio: "ignore" });

    mkdirSync(join(workspaceRoot, "data/tasks/done"), { recursive: true });
    renameSync(
      join(workspaceRoot, "data/tasks/doing/task-target.md"),
      join(workspaceRoot, "data/tasks/done/task-target.md"),
    );
    writeTask(workspaceRoot, "done", "task-target", "Target work");

    expect(
      findExpectedTaskReviewTarget(workspaceRoot, {
        taskId: "task-target",
        taskPath: "data/tasks/doing/task-target.md",
      }),
    ).toMatchObject({
      path: "data/tasks/done/task-target.md",
      state: "done",
    });
  });

  it("rejects ambiguous copies of the expected task", () => {
    const workspaceRoot = makeGitProject();
    writeTask(workspaceRoot, "doing", "task-target", "Doing target");
    writeTask(workspaceRoot, "done", "task-target", "Done target");

    expect(() =>
      findExpectedTaskReviewTarget(workspaceRoot, {
        taskId: "task-target",
        taskPath: "data/tasks/doing/task-target.md",
      })
    ).toThrow(/expected task task-target.*ambiguous/i);
  });

  it("rejects an expected basename whose task identity changed", () => {
    const workspaceRoot = makeGitProject();
    const taskDir = join(workspaceRoot, "data/tasks/doing");
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(
      join(taskDir, "task-target.md"),
      "---\nid: task-unrelated\ntitle: Unrelated\nstatus: doing\n---\n",
    );

    expect(() =>
      findExpectedTaskReviewTarget(workspaceRoot, {
        taskId: "task-target",
        taskPath: "data/tasks/doing/task-target.md",
      })
    ).toThrow(/expected task task-target.*contains task-unrelated/i);
  });

  it("fails closed when the expected task is missing", () => {
    const workspaceRoot = makeGitProject();
    writeTask(workspaceRoot, "doing", "task-alpha", "Concurrent alpha work");

    expect(() =>
      findExpectedTaskReviewTarget(workspaceRoot, {
        taskId: "task-target",
        taskPath: "data/tasks/doing/task-target.md",
      })
    ).toThrow(/expected task task-target.*not found/i);
  });

  it("collects task mutation evidence through the injected workflow runner", async () => {
    const workspaceRoot = makeGitProject();
    const runCommand = vi.fn(successfulWorkflowCommandRun);
    runCommand.mockResolvedValueOnce({
      ...(await successfulWorkflowCommandRun({ command: "git" })),
      stdout: {
        text: "M\tdata/tasks/done/task-target.md\n",
        totalBytes: 39,
        truncated: false,
      },
    });

    await expect(
      readTaskReviewMutationStatus(workspaceRoot, runCommand),
    ).resolves.toBe("M\tdata/tasks/done/task-target.md\n");
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "git",
        args: [
          "diff",
          "HEAD",
          "--name-status",
          "--",
          "data/tasks/done/",
          "data/tasks/blocked/",
        ],
        cwd: workspaceRoot,
      }),
    );
  });
});
