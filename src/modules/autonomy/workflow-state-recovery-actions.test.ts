import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { createAutomationWorktree } from "#modules/git/worktree-lifecycle.js";
import {
  claimTask,
  markTaskClaimPendingMerge,
  taskClaimPath,
} from "./task-claims.js";
import {
  claimInput,
  makeProject,
  writeOwnerRunMetadata,
  writeTask,
} from "./task-claims-test-support.js";
import { createWorkflowStateRecoveryProvider } from "./workflow-state-recovery.js";

function initializeGitFixture(projectDir: string): (args: string[]) => string {
  const env = {
    ...withProtectedGitBareRepositoryEnv(),
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  const git = (args: string[]): string =>
    execFileSync("git", args, {
      cwd: projectDir,
      env,
      encoding: "utf8",
    }).trim();
  writeFileSync(join(projectDir, ".gitignore"), ".kota/\n.worktrees/\n", "utf8");
  git(["init", "--quiet", "--initial-branch=main"]);
  git(["add", ".gitignore", "data/tasks/ready"]);
  git(["commit", "--quiet", "-m", "fixture"]);
  return git;
}

describe("workflow state recovery actions", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProject();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function createPendingMergeClaim(taskId: string, runId: string, evidence: string): void {
    writeTask(projectDir, "ready", taskId, "2026-06-27T00:00:00.000Z");
    const claimed = claimTask(
      claimInput(projectDir, taskId, runId, new Date("2026-06-27T00:01:00.000Z")),
    );
    expect(claimed.claimed).toBe(true);
    const pending = markTaskClaimPendingMerge({
      projectDir,
      taskId,
      runId,
      workflowId: "builder",
      evidence,
      now: new Date("2026-06-27T00:02:00.000Z"),
    });
    expect(pending.changed).toBe(true);
    expect(pending.claim).not.toBeNull();
  }

  it("lists and releases a pending-merge claim after a successful owner run", () => {
    createPendingMergeClaim("task-release", "run-release", "owner run completed after merge");
    writeOwnerRunMetadata(projectDir, "run-release", "builder", "success");
    const provider = createWorkflowStateRecoveryProvider();

    const listed = provider.list({ projectDir });
    expect(listed).toMatchObject({
      ok: true,
      claims: [
        {
          claim: {
            taskId: "task-release",
            runId: "run-release",
            status: "pending-merge",
          },
          ownerRunStatus: "success",
          recommendedAction: {
            kind: "release",
          },
        },
      ],
    });

    const resolved = provider.resolve({
      projectDir,
      taskId: "task-release",
      runId: "run-release",
      action: "release",
      rationale: "owner run completed and no merge blocker remains",
      artifactRunId: "run-recovery",
      actor: "test",
    });

    expect(resolved).toMatchObject({
      ok: true,
      action: "release",
      artifact: {
        actor: "test",
        taskId: "task-release",
        requestedRunId: "run-release",
        result: "released",
        before: {
          recommendedAction: {
            kind: "release",
          },
        },
        after: null,
      },
    });
    if (!resolved.ok) throw new Error("expected release to succeed");
    expect(resolved.artifactPath).toContain(".kota/runs/run-recovery/workflow-state-recovery.json");
    expect(existsSync(resolved.artifactPath)).toBe(true);
    expect(existsSync(taskClaimPath(projectDir, "task-release"))).toBe(false);

    const repeated = provider.resolve({
      projectDir,
      taskId: "task-release",
      runId: "run-release",
      action: "release",
      rationale: "repeat is idempotent",
      artifactRunId: "run-recovery-repeat",
    });
    expect(repeated).toMatchObject({
      ok: true,
      action: "noop",
      artifact: {
        result: "noop",
        before: null,
        after: null,
      },
    });
  });

  it("rejects traversal artifactRunId values without writing outside .kota/runs", () => {
    const provider = createWorkflowStateRecoveryProvider();

    const resolved = provider.resolve({
      projectDir,
      taskId: "task-missing",
      action: "release",
      rationale: "invalid artifact run id must not write an artifact",
      artifactRunId: "../../escaped",
    });

    expect(resolved).toMatchObject({
      ok: false,
      reason: "invalid_input",
      message: expect.stringContaining("path-safe segment"),
    });
    expect(resolved).not.toHaveProperty("artifactPath");
    expect(existsSync(join(projectDir, "escaped", "workflow-state-recovery.json"))).toBe(false);
    expect(existsSync(join(projectDir, ".kota", "escaped", "workflow-state-recovery.json"))).toBe(false);
    expect(existsSync(join(projectDir, ".kota", "runs"))).toBe(false);
  });

  it("refuses release when claim evidence still says the merge is pending", () => {
    createPendingMergeClaim(
      "task-still-pending",
      "run-still-pending",
      "builder branch is pending merge",
    );
    writeOwnerRunMetadata(projectDir, "run-still-pending", "builder", "success");
    const provider = createWorkflowStateRecoveryProvider();

    const listed = provider.list({ projectDir });
    expect(listed.ok).toBe(true);
    expect(listed.ok ? listed.claims[0]?.recommendedAction : null).toMatchObject({
      kind: "needs-review",
      reason: "worktree or claim contains unresolved branch integration evidence",
    });

    const resolved = provider.resolve({
      projectDir,
      taskId: "task-still-pending",
      runId: "run-still-pending",
      action: "release",
      rationale: "owner run completed",
      artifactRunId: "run-still-pending-refused",
    });

    expect(resolved).toMatchObject({
      ok: false,
      reason: "unsafe",
      artifact: {
        result: "refused",
        before: {
          recommendedAction: {
            kind: "needs-review",
          },
        },
        after: {
          claim: {
            taskId: "task-still-pending",
            runId: "run-still-pending",
            status: "pending-merge",
          },
        },
      },
    });
    expect(existsSync(taskClaimPath(projectDir, "task-still-pending"))).toBe(true);
  });

  it("refuses to supersede while unresolved merge evidence remains", () => {
    createPendingMergeClaim("task-conflict", "run-conflict", "merge conflict needs resolution");
    writeOwnerRunMetadata(projectDir, "run-conflict", "builder", "failed");
    const provider = createWorkflowStateRecoveryProvider();

    const listed = provider.list({ projectDir });
    expect(listed.ok).toBe(true);
    expect(listed.ok ? listed.claims[0]?.recommendedAction : null).toMatchObject({
      kind: "needs-review",
    });

    const resolved = provider.resolve({
      projectDir,
      taskId: "task-conflict",
      runId: "run-conflict",
      action: "supersede",
      rationale: "failed run should be replaced",
      artifactRunId: "run-refused",
    });

    expect(resolved).toMatchObject({
      ok: false,
      reason: "unsafe",
      artifact: {
        result: "refused",
        after: {
          claim: {
            taskId: "task-conflict",
            runId: "run-conflict",
            status: "pending-merge",
          },
        },
      },
    });
    expect(existsSync(taskClaimPath(projectDir, "task-conflict"))).toBe(true);
  });

  it("accepts canonical supersession evidence without requiring worktree cleanup", () => {
    createPendingMergeClaim(
      "task-canonical-supersession",
      "run-canonical-supersession",
      "builder branch is pending merge",
    );
    writeOwnerRunMetadata(projectDir, "run-canonical-supersession", "builder", "success");
    const git = initializeGitFixture(projectDir);

    const resolved = createWorkflowStateRecoveryProvider().resolve({
      projectDir,
      taskId: "task-canonical-supersession",
      runId: "run-canonical-supersession",
      action: "supersede",
      rationale: "the reviewed branch was integrated by the canonical merge",
      artifactRunId: "run-canonical-supersession-resolution",
      supersededByCommit: git(["rev-parse", "HEAD"]),
    });

    expect(resolved).toMatchObject({
      ok: true,
      action: "supersede",
      artifact: {
        result: "superseded",
      },
    });
    if (!resolved.ok) throw new Error("expected supersession to succeed");
    expect(resolved.artifact).not.toHaveProperty("worktreeCleanup");
    expect(existsSync(taskClaimPath(projectDir, "task-canonical-supersession"))).toBe(false);
  });

  it("supersedes a dirty terminal worktree only with an explicit replacement and discard", () => {
    const taskId = "task-dirty-recovery";
    const runId = "run-dirty-recovery";
    writeTask(projectDir, "ready", taskId, "2026-06-27T00:00:00.000Z");
    const git = initializeGitFixture(projectDir);

    const worktree = createAutomationWorktree({
      projectDir,
      taskId,
      runId,
      workflowId: "builder",
      owner: `workflow:builder:${runId}`,
    });
    const claimed = claimTask({
      ...claimInput(projectDir, taskId, runId, new Date("2026-06-27T00:01:00.000Z")),
      workspaceDir: worktree.metadata.workspaceDir,
      branch: worktree.metadata.branch,
      baseCommit: worktree.metadata.baseCommit,
    });
    expect(claimed.claimed).toBe(true);
    const pending = markTaskClaimPendingMerge({
      projectDir,
      taskId,
      runId,
      workflowId: "builder",
      evidence: "merge conflict needs resolution",
      now: new Date("2026-06-27T00:02:00.000Z"),
    });
    expect(pending.changed).toBe(true);
    writeOwnerRunMetadata(projectDir, runId, "builder", "failed");
    writeFileSync(join(worktree.metadata.workspaceDir, "uncommitted.txt"), "stale\n", "utf8");

    const provider = createWorkflowStateRecoveryProvider();
    const listed = provider.list({ projectDir });
    expect(listed.ok).toBe(true);
    expect(listed.ok ? listed.claims[0]?.recommendedAction.kind : null).toBe("needs-review");
    expect(listed.ok ? listed.claims[0]?.worktree.uniqueCommitCount : null).toBe(0);

    const resolved = provider.resolve({
      projectDir,
      taskId,
      runId,
      action: "supersede",
      rationale: "canonical replacement was reviewed and accepted",
      artifactRunId: "run-dirty-recovery-resolution",
      supersededByCommit: git(["rev-parse", "HEAD"]),
      cleanupWorktree: true,
      discardWorktreeChanges: true,
    });

    expect(resolved).toMatchObject({
      ok: true,
      action: "supersede",
      artifact: {
        result: "superseded",
        worktreeCleanup: {
          attempted: true,
          removed: true,
        },
      },
    });
    expect(existsSync(worktree.metadata.workspaceDir)).toBe(false);
    expect(existsSync(taskClaimPath(projectDir, taskId))).toBe(false);
  });

  it("writes a before and after artifact when superseding a failed stale claim", () => {
    createPendingMergeClaim("task-supersede", "run-supersede", "builder run failed after validation");
    writeOwnerRunMetadata(projectDir, "run-supersede", "builder", "interrupted");
    const provider = createWorkflowStateRecoveryProvider();

    const resolved = provider.resolve({
      projectDir,
      taskId: "task-supersede",
      runId: "run-supersede",
      action: "supersede",
      rationale: "interrupted run has no remaining merge blocker",
      artifactRunId: "run-supersede-artifact",
    });

    expect(resolved).toMatchObject({
      ok: true,
      action: "supersede",
      artifact: {
        result: "superseded",
        before: {
          recommendedAction: {
            kind: "supersede",
          },
        },
        after: null,
      },
    });
    if (!resolved.ok) throw new Error("expected supersede to succeed");
    const persisted = JSON.parse(readFileSync(resolved.artifactPath, "utf8"));
    expect(persisted).toMatchObject({
      schemaVersion: 1,
      taskId: "task-supersede",
      result: "superseded",
    });
    expect(existsSync(taskClaimPath(projectDir, "task-supersede"))).toBe(false);
  });

  it("lists and supersedes an active claim whose owner run failed", () => {
    writeTask(
      projectDir,
      "ready",
      "task-failed-active",
      "2026-06-27T00:00:00.000Z",
    );
    const claimed = claimTask(
      claimInput(
        projectDir,
        "task-failed-active",
        "run-failed-active",
        new Date("2026-06-27T00:01:00.000Z"),
      ),
    );
    expect(claimed.claimed).toBe(true);
    writeOwnerRunMetadata(
      projectDir,
      "run-failed-active",
      "builder",
      "failed",
    );
    const provider = createWorkflowStateRecoveryProvider();

    const listed = provider.list({ projectDir });
    expect(listed).toMatchObject({
      ok: true,
      claims: [
        {
          claim: {
            taskId: "task-failed-active",
            status: "active",
          },
          recoveryStatus: "stale",
          ownerRunStatus: "failed",
          recommendedAction: {
            kind: "supersede",
          },
        },
      ],
    });

    const resolved = provider.resolve({
      projectDir,
      taskId: "task-failed-active",
      runId: "run-failed-active",
      action: "supersede",
      rationale: "terminal failed run cannot retain an active task lease",
      artifactRunId: "run-failed-active-recovery",
    });

    expect(resolved).toMatchObject({
      ok: true,
      action: "supersede",
      artifact: {
        result: "superseded",
        before: {
          recoveryStatus: "stale",
        },
        after: null,
      },
    });
    expect(
      existsSync(taskClaimPath(projectDir, "task-failed-active")),
    ).toBe(false);
  });
});
