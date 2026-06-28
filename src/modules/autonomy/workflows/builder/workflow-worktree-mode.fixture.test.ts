import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import builderWorkflow from "./workflow.js";

vi.mock("#core/config/config.js", () => ({
  loadConfig: vi.fn(() => ({
    modules: { builder: { branchPerTask: true } },
  })),
}));

vi.mock("./branch-per-task.js", async () => {
  const actual =
    await vi.importActual<typeof import("./branch-per-task.js")>(
      "./branch-per-task.js",
    );
  return {
    ...actual,
    createPullRequest: vi.fn(() => ({
      prUrl: "https://github.com/org/repo/pull/42",
    })),
    cleanupMergedBranches: vi.fn(() => ({ cleaned: [], warnings: [] })),
  };
});

const repos: string[] = [];

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: {
      ...withProtectedGitBareRepositoryEnv(),
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function writeReadyTask(projectDir: string): void {
  const taskDir = join(projectDir, "data", "tasks", "ready");
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(
    join(taskDir, "task-worktree-fixture.md"),
    `---
id: task-worktree-fixture
title: Verify builder worktree fixture
status: ready
priority: p1
area: autonomy
task_class: Platform
summary: Verify that builder worktree mode writes and commits outside the canonical checkout.
created_at: 2026-06-27T00:00:00.000Z
updated_at: 2026-06-27T00:00:00.000Z
---

## Problem

The builder worktree mode needs fixture evidence that mutations land in the
task worktree instead of the canonical checkout.

## Desired Outcome

The workflow prepares a task worktree, writes a file there, commits there, and
leaves the canonical checkout clean.

## Constraints

Keep the fixture local and deterministic.

## Done When

- The fixture file is committed on the task worktree branch.
- The canonical checkout has no tracked or untracked residue.

## Source / Intent

Builder worktree-mode regression coverage.

## Initiative

Worktree-backed KOTA autonomy.

## Acceptance Evidence

- This fixture test runs the builder workflow against a disposable git repo.
`,
  );
}

function initFixtureRepo(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "kota-builder-worktree-fixture-"));
  repos.push(projectDir);
  git(projectDir, ["init", "--quiet", "--initial-branch=main"]);
  git(projectDir, ["config", "user.email", "test@example.com"]);
  git(projectDir, ["config", "user.name", "Test"]);
  writeFileSync(join(projectDir, ".gitignore"), ".kota/\n.worktrees/\n", "utf8");
  writeFileSync(join(projectDir, "README.md"), "# Fixture\n", "utf8");
  writeReadyTask(projectDir);
  git(projectDir, ["add", "."]);
  git(projectDir, ["commit", "--quiet", "-m", "initial"]);
  return projectDir;
}

function gitStatus(projectDir: string): string {
  return git(projectDir, ["status", "--porcelain=v1", "--untracked-files=all"]);
}

afterEach(() => {
  for (const repo of repos.splice(0)) {
    rmSync(repo, { recursive: true, force: true });
  }
});

describe("builder workflow worktree-mode fixture", () => {
  it("writes and commits inside the task worktree while leaving the canonical checkout clean", async () => {
    const projectDir = initFixtureRepo();
    const fixtureRelativePath = join("src", "builder-worktree-fixture.txt");
    let buildWorkspaceDir: string | undefined;
    let buildRuntimeProfileId: string | undefined;
    let buildRuntimePortBase: string | undefined;

    const harness = new WorkflowTestHarness(builderWorkflow, {
      projectDir,
      trigger: {
        event: "autonomy.queue.available",
        payload: {
          pullableCount: 1,
          actionableCount: 1,
          counts: {
            backlog: 0,
            ready: 1,
            doing: 0,
            blocked: 0,
            done: 0,
            dropped: 0,
          },
        },
      },
      stepMocks: {
        build: (ctx) => {
          const workspaceDir = ctx.workspaceDir ?? ctx.projectDir;
          buildWorkspaceDir = workspaceDir;
          buildRuntimeProfileId = ctx.runtimeResources?.profileId;
          buildRuntimePortBase = ctx.runtimeResources?.env.KOTA_PORT_BASE;
          if (workspaceDir === ctx.projectDir) {
            throw new Error("build step did not receive the prepared task worktree");
          }
          if (ctx.runtimeResources?.tempRoot === undefined) {
            throw new Error("build step did not receive runtime resource roots");
          }
          mkdirSync(join(workspaceDir, "src"), { recursive: true });
          writeFileSync(
            join(workspaceDir, fixtureRelativePath),
            "created in the task worktree\n",
            "utf8",
          );
          const readyTaskPath = join(
            workspaceDir,
            "data",
            "tasks",
            "ready",
            "task-worktree-fixture.md",
          );
          const doneTaskDir = join(workspaceDir, "data", "tasks", "done");
          const doneTaskPath = join(doneTaskDir, "task-worktree-fixture.md");
          mkdirSync(doneTaskDir, { recursive: true });
          writeFileSync(
            readyTaskPath,
            readFileSync(readyTaskPath, "utf8")
              .replace("status: ready", "status: done")
              .replace(
                "updated_at: 2026-06-27T00:00:00.000Z",
                "updated_at: 2026-06-27T00:00:01.000Z",
              ),
            "utf8",
          );
          renameSync(readyTaskPath, doneTaskPath);
          mkdirSync(ctx.workflow.runDirPath, { recursive: true });
          writeFileSync(
            join(ctx.workflow.runDirPath, "commit-message.txt"),
            "Builder worktree fixture\n",
            "utf8",
          );
          return { turns: [], totalCostUsd: 0.01 };
        },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps.commit.output).toMatchObject({
      committed: true,
      message: "Builder worktree fixture",
    });
    expect(buildWorkspaceDir).toBeDefined();
    expect(buildWorkspaceDir).not.toBe(projectDir);
    expect(buildWorkspaceDir).toContain(`${projectDir}/.worktrees/`);
    expect(buildRuntimeProfileId).toBe("task-worktree-fixture:harness-run-id");
    expect(buildRuntimePortBase).toMatch(/^\d+$/);

    const workspaceDir = buildWorkspaceDir!;
    expect(existsSync(join(workspaceDir, fixtureRelativePath))).toBe(true);
    expect(existsSync(join(projectDir, fixtureRelativePath))).toBe(false);
    expect(git(workspaceDir, ["log", "--format=%s", "-1"])).toBe(
      "Builder worktree fixture",
    );
    const committedFiles = git(workspaceDir, [
      "show",
      "--name-only",
      "--format=",
      "HEAD",
    ])
      .split("\n")
      .filter(Boolean);
    expect(committedFiles).toContain(fixtureRelativePath);
    expect(committedFiles).toContain(
      join("data", "tasks", "done", "task-worktree-fixture.md"),
    );
    expect(gitStatus(workspaceDir)).toBe("");
    expect(gitStatus(projectDir)).toBe("");

    const workspaceArtifact = JSON.parse(
      readFileSync(
        join(projectDir, ".kota", "runs", "harness", "builder-workspace.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(workspaceArtifact).toMatchObject({
      enabled: true,
      projectDir,
      workspaceDir,
      branch: "kota/task/task-worktree-fixture/harness-run-id",
      taskId: "task-worktree-fixture",
      claimId: "task-worktree-fixture:harness-run-id",
      runtimeResources: {
        profileId: "task-worktree-fixture:harness-run-id",
        workspaceDir,
        env: {
          KOTA_WORKSPACE_DIR: workspaceDir,
          KOTA_RUNTIME_PROFILE_ID: "task-worktree-fixture:harness-run-id",
        },
      },
    });
    expect(
      existsSync(
        join(projectDir, ".kota", "runs", "harness", "builder-runtime-resources.json"),
      ),
    ).toBe(true);
  });
});
