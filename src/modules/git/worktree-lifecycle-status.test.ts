import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import {
  continueAutomationWorktree,
  createAutomationWorktree,
  listAutomationWorktreeStatuses,
  lockAutomationWorktree,
  markAutomationWorktreeMerged,
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

function writeWorkflowState(repo: string, activeRunIds: string[]): void {
  mkdirSync(join(repo, ".kota"), { recursive: true });
  writeFileSync(
    join(repo, ".kota", "workflow-state.json"),
    `${JSON.stringify({
      completedRuns: 0,
      pendingRuns: [],
      activeRuns: activeRunIds.map((runId) => ({ runId, workflow: "builder", startedAt: "2026-01-01T00:00:00.000Z" })),
      workflows: {},
    }, null, 2)}\n`,
    "utf8",
  );
}

function writeRunMetadata(repo: string, runId: string, status: string): void {
  const runDir = join(repo, ".kota", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "metadata.json"),
    `${JSON.stringify({
      id: runId,
      workflow: "builder",
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      trigger: { event: "test", payload: {} },
      startedAt: "2026-01-01T00:00:00.000Z",
      status,
      runDir: `.kota/runs/${runId}`,
      steps: [],
    }, null, 2)}\n`,
    "utf8",
  );
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
    writeWorkflowState(repo, [active.metadata.runId]);
    writeRunMetadata(repo, active.metadata.runId, "running");
    updateAutomationWorktreeRuntimeResources(
      { projectDir: repo, taskId: active.metadata.taskId, runId: active.metadata.runId },
      {
        profileId: "task-add-worktree-provider:run-active",
        agentRunDir: join(active.metadata.workspaceDir, ".kota", "runs", "run-active"),
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
    markAutomationWorktreeMerged(
      { projectDir: repo, taskId: merged.metadata.taskId, runId: merged.metadata.runId },
      merged.headCommit,
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
      runState: "active",
      cleanupStatus: "blocked",
      cleanupEligible: false,
    });
    expect(byRun.get("run-active")?.cleanupBlockers).toContain("worktree run is active");
    expect(byRun.get("run-active")?.cleanupBlockers).toContain("worktree is locked: builder agent running");
    expect(byRun.get("run-active")?.runtimeResources).toEqual({
      profileId: "task-add-worktree-provider:run-active",
      agentRunDir: join(active.metadata.workspaceDir, ".kota", "runs", "run-active"),
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

  it("ignores merge-gate sidecar records when listing lifecycle metadata", () => {
    const repo = initRepo("merge-gate-sidecar");
    const active = createFixtureWorktree(repo, "run-active");
    writeWorkflowState(repo, [active.metadata.runId]);
    writeRunMetadata(repo, active.metadata.runId, "running");
    writeFileSync(
      active.metadataPath.replace(/\.json$/, ".merge-gate.json"),
      `${JSON.stringify({ status: "merged", mergedCommit: active.headCommit }, null, 2)}\n`,
      "utf8",
    );

    const statuses = listAutomationWorktreeStatuses(repo);

    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({
      runId: "run-active",
      state: "active",
      runState: "active",
    });
  });

  it("surfaces active metadata with a finished run as stale", () => {
    const repo = initRepo("stale");
    const stale = createFixtureWorktree(repo, "run-stale");
    lockAutomationWorktree(
      { projectDir: repo, taskId: stale.metadata.taskId, runId: stale.metadata.runId },
      "builder agent running",
    );
    writeWorkflowState(repo, []);
    writeRunMetadata(repo, stale.metadata.runId, "failed");

    const status = listAutomationWorktreeStatuses(repo)[0];

    expect(status).toMatchObject({
      runId: "run-stale",
      state: "stale",
      metadataState: "active",
      runState: "finished",
      cleanupStatus: "blocked",
      cleanupEligible: false,
      nextAction: "unlock stale worktree after verifying workspace changes: builder agent running",
    });
    expect(status.cleanupBlockers).toContain("stale worktree is locked: builder agent running");
  });

  it("attributes a preserved worktree to its active recovery run", () => {
    const repo = initRepo("recovery-owner");
    const preserved = createFixtureWorktree(repo, "run-failed");
    writeFileSync(
      join(preserved.metadata.workspaceDir, "README.md"),
      "# Preserved recovery work\n",
      "utf8",
    );
    writeRunMetadata(repo, "run-failed", "failed");
    writeRunMetadata(repo, "run-recovery", "running");
    writeWorkflowState(repo, ["run-recovery"]);

    continueAutomationWorktree(
      {
        projectDir: repo,
        taskId: preserved.metadata.taskId,
        runId: preserved.metadata.runId,
      },
      "run-recovery",
    );

    expect(listAutomationWorktreeStatuses(repo)[0]).toMatchObject({
      runId: "run-failed",
      recoveryRunId: "run-recovery",
      state: "active",
      runState: "active",
      dirtyState: "dirty",
      cleanupStatus: "blocked",
    });
  });
});
