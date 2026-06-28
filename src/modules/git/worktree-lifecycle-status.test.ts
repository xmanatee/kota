import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import {
  createAutomationWorktree,
  listAutomationWorktreeStatuses,
  lockAutomationWorktree,
  updateAutomationWorktreeRuntimeResources,
  updateAutomationWorktreeState,
} from "./worktree-lifecycle.js";

const repos: string[] = [];

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...withProtectedGitBareRepositoryEnv(),
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: gitEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitResult(cwd: string, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync("git", args, {
    cwd,
    env: gitEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function initRepo(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `kota-worktree-status-${label}-`));
  repos.push(dir);
  git(dir, ["init", "--quiet", "--initial-branch=main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  writeFileSync(join(dir, ".gitignore"), ".kota/\n.worktrees/\n", "utf8");
  writeFileSync(join(dir, "README.md"), "# Fixture\n", "utf8");
  git(dir, ["add", ".gitignore", "README.md"]);
  git(dir, ["commit", "--quiet", "-m", "initial"]);
  return dir;
}

function createFixtureWorktree(repo: string, runId: string) {
  return createAutomationWorktree({
    projectDir: repo,
    taskId: "task-add-worktree-provider",
    runId,
    workflowId: "builder",
    owner: "test-owner",
  });
}

afterEach(() => {
  for (const repo of repos.splice(0)) {
    rmSync(repo, { recursive: true, force: true });
  }
});

describe("automation worktree operator statuses", () => {
  it("lists lifecycle, merge, dirty, and cleanup state for operator surfaces", () => {
    const repo = initRepo("operator-status");
    const active = createFixtureWorktree(repo, "run-active");
    lockAutomationWorktree(
      { projectDir: repo, taskId: active.metadata.taskId, runId: active.metadata.runId },
      "builder agent running",
    );
    updateAutomationWorktreeRuntimeResources(
      { projectDir: repo, taskId: active.metadata.taskId, runId: active.metadata.runId },
      {
        profileId: "task-add-worktree-provider:run-active",
        tempRoot: join(active.metadata.workspaceDir, ".kota", "tmp", "run-active"),
        artifactRoot: join(repo, ".kota", "runs", "run-active", "artifacts"),
        ports: { start: 41_000, end: 41_019 },
      },
    );
    const pending = createFixtureWorktree(repo, "run-pending");
    updateAutomationWorktreeState(
      { projectDir: repo, taskId: pending.metadata.taskId, runId: pending.metadata.runId },
      "pending-merge",
      "text conflicts require review",
    );
    const merged = createFixtureWorktree(repo, "run-merged");
    updateAutomationWorktreeState(
      { projectDir: repo, taskId: merged.metadata.taskId, runId: merged.metadata.runId },
      "merged",
      "merge gate accepted branch",
    );
    const conflicted = createFixtureWorktree(repo, "run-conflicted");

    writeFileSync(join(repo, "README.md"), "# Fixture\ncanonical\n", "utf8");
    git(repo, ["add", "README.md"]);
    git(repo, ["commit", "--quiet", "-m", "canonical change"]);
    writeFileSync(join(conflicted.metadata.workspaceDir, "README.md"), "# Fixture\nworkspace\n", "utf8");
    git(conflicted.metadata.workspaceDir, ["add", "README.md"]);
    git(conflicted.metadata.workspaceDir, ["commit", "--quiet", "-m", "workspace change"]);
    expect(gitResult(conflicted.metadata.workspaceDir, ["merge", "main"]).status).not.toBe(0);

    const byRun = new Map(listAutomationWorktreeStatuses(repo).map((status) => [status.runId, status]));
    expect(byRun.get("run-active")).toMatchObject({
      state: "active",
      cleanupStatus: "blocked",
      cleanupEligible: false,
    });
    expect(byRun.get("run-active")?.cleanupBlockers).toContain("worktree is locked: builder agent running");
    expect(byRun.get("run-active")?.runtimeResources).toEqual({
      profileId: "task-add-worktree-provider:run-active",
      tempRoot: join(active.metadata.workspaceDir, ".kota", "tmp", "run-active"),
      artifactRoot: join(repo, ".kota", "runs", "run-active", "artifacts"),
      ports: { start: 41_000, end: 41_019 },
    });
    expect(byRun.get("run-pending")).toMatchObject({
      state: "pending-merge",
      mergeStatus: "pending-merge: text conflicts require review",
    });
    expect(byRun.get("run-merged")).toMatchObject({
      state: "merged",
      cleanupStatus: "eligible",
      cleanupEligible: true,
    });
    expect(byRun.get("run-conflicted")).toMatchObject({
      state: "conflicted",
      dirtyState: "conflicted",
      mergeStatus: "conflicted",
    });
  });
});
