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

async function findReviewTarget(projectDir: string) {
  const runCommand = createWorkflowCommandRunner({ cwd: projectDir });
  const mutationStatus = await readTaskReviewMutationStatus(
    projectDir,
    runCommand,
  );
  return findTaskReviewTarget(projectDir, mutationStatus);
}

describe("findTaskReviewTarget", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reviews a staged done task before collateral blocked task edits", async () => {
    const projectDir = makeGitProject();
    writeTask(projectDir, "blocked", "task-collateral-blocker", "Collateral blocker");
    writeTask(projectDir, "done", "task-implemented-work", "Implemented work");
    execFileSync("git", ["add", "data/tasks/blocked", "data/tasks/done"], {
      cwd: projectDir,
      stdio: "ignore",
    });

    expect(await findReviewTarget(projectDir)).toMatchObject({
      path: "data/tasks/done/task-implemented-work.md",
      state: "done",
    });
  });

  it("reviews a staged ready-to-done move before collateral blocked edits", async () => {
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

    expect(await findReviewTarget(projectDir)).toMatchObject({
      path: "data/tasks/done/task-implemented-work.md",
      state: "done",
    });
  });

  it("reviews a staged blocked task when there is no staged done task", async () => {
    const projectDir = makeGitProject();
    writeTask(projectDir, "blocked", "task-real-blocker", "Real blocker");
    execFileSync("git", ["add", "data/tasks/blocked"], { cwd: projectDir, stdio: "ignore" });

    expect(await findReviewTarget(projectDir)).toMatchObject({
      path: "data/tasks/blocked/task-real-blocker.md",
      state: "blocked",
    });
  });

  it("reviews an active doing task before staged terminal-state tasks", async () => {
    const projectDir = makeGitProject();
    writeTask(projectDir, "doing", "task-active", "Active work");
    writeTask(projectDir, "done", "task-implemented-work", "Implemented work");
    execFileSync("git", ["add", "data/tasks/done"], { cwd: projectDir, stdio: "ignore" });

    expect(await findReviewTarget(projectDir)).toMatchObject({
      path: "data/tasks/doing/task-active.md",
      state: "doing",
    });
  });

  it("finds the expected task after an unstaged doing-to-done move", () => {
    const projectDir = makeGitProject();
    writeTask(projectDir, "doing", "task-alpha", "Concurrent alpha work");
    writeTask(projectDir, "doing", "task-target", "Target work");
    execFileSync("git", ["add", "data/tasks/doing"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: projectDir, stdio: "ignore" });

    mkdirSync(join(projectDir, "data/tasks/done"), { recursive: true });
    renameSync(
      join(projectDir, "data/tasks/doing/task-target.md"),
      join(projectDir, "data/tasks/done/task-target.md"),
    );
    writeTask(projectDir, "done", "task-target", "Target work");

    expect(
      findExpectedTaskReviewTarget(projectDir, {
        taskId: "task-target",
        taskPath: "data/tasks/doing/task-target.md",
      }),
    ).toMatchObject({
      path: "data/tasks/done/task-target.md",
      state: "done",
    });
  });

  it("rejects ambiguous copies of the expected task", () => {
    const projectDir = makeGitProject();
    writeTask(projectDir, "doing", "task-target", "Doing target");
    writeTask(projectDir, "done", "task-target", "Done target");

    expect(() =>
      findExpectedTaskReviewTarget(projectDir, {
        taskId: "task-target",
        taskPath: "data/tasks/doing/task-target.md",
      })
    ).toThrow(/expected task task-target.*ambiguous/i);
  });

  it("rejects an expected basename whose task identity changed", () => {
    const projectDir = makeGitProject();
    const taskDir = join(projectDir, "data/tasks/doing");
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(
      join(taskDir, "task-target.md"),
      "---\nid: task-unrelated\ntitle: Unrelated\nstatus: doing\n---\n",
    );

    expect(() =>
      findExpectedTaskReviewTarget(projectDir, {
        taskId: "task-target",
        taskPath: "data/tasks/doing/task-target.md",
      })
    ).toThrow(/expected task task-target.*contains task-unrelated/i);
  });

  it("fails closed when the expected task is missing", () => {
    const projectDir = makeGitProject();
    writeTask(projectDir, "doing", "task-alpha", "Concurrent alpha work");

    expect(() =>
      findExpectedTaskReviewTarget(projectDir, {
        taskId: "task-target",
        taskPath: "data/tasks/doing/task-target.md",
      })
    ).toThrow(/expected task task-target.*not found/i);
  });

  it("collects task mutation evidence through the injected workflow runner", async () => {
    const projectDir = makeGitProject();
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
      readTaskReviewMutationStatus(projectDir, runCommand),
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
        cwd: projectDir,
      }),
    );
  });
});
