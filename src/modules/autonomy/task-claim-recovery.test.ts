import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAutomationWorktree } from "#modules/git/worktree-lifecycle.js";
import {
  claimNextQueueTask,
  claimTask,
  continueTaskClaim,
  expireTaskClaim,
  listTaskClaimInspections,
  markTaskClaimPendingDecomposition,
  markTaskClaimPendingMerge,
  releaseTaskClaim,
  resumeTaskClaim,
  supersedeTaskClaim,
  taskClaimPath,
  updateTaskClaimWorkspace,
} from "./task-claims.js";
import {
  claimInput,
  makeProject,
  queueInput,
  writeOwnerRunMetadata,
  writeTask,
} from "./task-claims-test-support.js";

let projectDir: string;

function initializeGitProject(): void {
  writeFileSync(join(projectDir, ".gitignore"), ".kota/\n.worktrees/\n", "utf8");
  writeFileSync(join(projectDir, "README.md"), "# Claim recovery fixture\n", "utf8");
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: projectDir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: projectDir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: projectDir });
  execFileSync("git", ["add", "."], { cwd: projectDir });
  execFileSync("git", ["commit", "--quiet", "-m", "initial"], { cwd: projectDir });
}

describe("task claim recovery lifecycle", () => {
  beforeEach(() => {
    projectDir = makeProject();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("lists stale claims and supports resume, pending, expire, replace, and release recovery", () => {
    writeTask(projectDir, "ready", "task-alpha", "2026-06-27T00:00:00.000Z");
    const acquiredAt = new Date("2026-06-27T01:00:00.000Z");
    const claim = claimTask({
      ...claimInput(projectDir, "task-alpha", "run-a", acquiredAt),
      leaseMs: 1_000,
    });
    expect(claim.claimed).toBe(true);

    const staleAt = new Date("2026-06-27T01:00:02.000Z");
    expect(listTaskClaimInspections(projectDir, staleAt)[0]).toMatchObject({
      recoveryStatus: "stale",
      safeToRetry: true,
    });

    const resumed = resumeTaskClaim({
      projectDir,
      taskId: "task-alpha",
      runId: "run-a",
      workflowId: "builder",
      evidence: "daemon restarted and resumed the same builder run",
      leaseMs: 60_000,
      now: staleAt,
    });
    expect(resumed).toMatchObject({
      changed: true,
      recoveryStatus: "agent-running",
      safeToRetry: false,
    });

    const workspace = updateTaskClaimWorkspace({
      projectDir,
      taskId: "task-alpha",
      runId: "run-a",
      workflowId: "builder",
      workspaceDir: "/tmp/kota-worktrees/task-alpha-run-a",
      branch: "kota/task/task-alpha/run-a",
      baseCommit: "abc123",
      evidence: "prepared builder worktree for the claimed task",
      now: new Date("2026-06-27T01:00:02.500Z"),
    });
    expect(workspace.claim).toMatchObject({
      workspaceDir: "/tmp/kota-worktrees/task-alpha-run-a",
      branch: "kota/task/task-alpha/run-a",
      baseCommit: "abc123",
      evidence: "prepared builder worktree for the claimed task",
    });

    const pending = markTaskClaimPendingMerge({
      projectDir,
      taskId: "task-alpha",
      runId: "run-a",
      workflowId: "builder",
      evidence: "merge conflict needs resolution",
      now: new Date("2026-06-27T01:00:03.000Z"),
    });
    expect(pending).toMatchObject({
      recoveryStatus: "pending-merge",
      safeToRetry: false,
    });

    const skipped = claimTask(claimInput(projectDir, "task-alpha", "run-b", new Date("2026-06-27T01:00:04.000Z")));
    expect(skipped).toMatchObject({
      claimed: false,
      recoveryPath: "skipped-pending-merge",
    });

    const expired = expireTaskClaim({
      projectDir,
      taskId: "task-alpha",
      runId: "run-a",
      workflowId: "builder",
      evidence: "operator expired abandoned claim",
      now: new Date("2026-06-27T01:00:05.000Z"),
    });
    expect(expired).toMatchObject({
      recoveryStatus: "expired",
      safeToRetry: true,
    });

    const replacement = claimTask(claimInput(projectDir, "task-alpha", "run-c", new Date("2026-06-27T01:00:06.000Z")));
    expect(replacement).toMatchObject({
      claimed: true,
      recoveryPath: "replaced-expired-claim",
    });

    const released = releaseTaskClaim({
      projectDir,
      taskId: "task-alpha",
      runId: "run-c",
      workflowId: "builder",
      evidence: "merged successfully",
      now: new Date("2026-06-27T01:00:07.000Z"),
    });
    expect(released).toMatchObject({
      changed: true,
      recoveryStatus: "released",
      safeToRetry: true,
    });
    expect(existsSync(taskClaimPath(projectDir, "task-alpha"))).toBe(false);
  });

  it("records an observable stale-claim status when the owning builder run has already ended unsuccessfully", () => {
    writeTask(projectDir, "ready", "task-alpha", "2026-06-27T00:00:00.000Z");
    const acquiredAt = new Date("2026-06-27T01:00:00.000Z");
    const original = claimTask({
      ...claimInput(projectDir, "task-alpha", "run-interrupted", acquiredAt),
      leaseMs: 7 * 60 * 60 * 1_000,
    });
    expect(original).toMatchObject({
      claimed: true,
      recoveryPath: "new-claim",
    });

    const beforeLeaseExpiry = new Date("2026-06-27T02:00:00.000Z");
    const blocked = claimTask(claimInput(projectDir, "task-alpha", "run-blocked", beforeLeaseExpiry));
    expect(blocked).toMatchObject({
      claimed: false,
      recoveryPath: "skipped-active-claim",
      recoveryStatus: "agent-running",
    });

    writeOwnerRunMetadata(projectDir, "run-interrupted", "builder", "interrupted");
    const replacement = claimTask(claimInput(projectDir, "task-alpha", "run-retry", beforeLeaseExpiry));
    const status = replacement.recoveryStatus;
    expect(status).toBe("agent-running");
    expect(replacement).toMatchObject({
      claimed: true,
      recoveryStatus: "agent-running",
      recoveryPath: "replaced-stale-claim",
      safeToRetry: false,
    });
    expect(replacement.claim?.runId).toBe("run-retry");
  });

  it("preserves a failed run claim while its dirty worktree awaits disposition", () => {
    writeTask(projectDir, "ready", "task-alpha", "2026-06-27T00:00:00.000Z");
    initializeGitProject();
    const acquiredAt = new Date("2026-06-27T01:00:00.000Z");
    expect(
      claimTask(claimInput(projectDir, "task-alpha", "run-failed", acquiredAt)),
    ).toMatchObject({ claimed: true });
    const worktree = createAutomationWorktree({
      projectDir,
      taskId: "task-alpha",
      runId: "run-failed",
      workflowId: "builder",
      owner: "workflow:builder:run-failed",
    });
    writeFileSync(
      join(worktree.metadata.workspaceDir, "README.md"),
      "# Preserved builder work\n",
      "utf8",
    );
    writeOwnerRunMetadata(projectDir, "run-failed", "builder", "failed");

    expect(
      listTaskClaimInspections(
        projectDir,
        new Date("2026-06-27T02:00:00.000Z"),
      )[0],
    ).toMatchObject({
      recoveryStatus: "stale",
      safeToRetry: false,
    });
    expect(
      claimTask(
        claimInput(
          projectDir,
          "task-alpha",
          "run-retry",
          new Date("2026-06-27T02:00:00.000Z"),
        ),
      ),
    ).toMatchObject({
      claimed: false,
      recoveryStatus: "stale",
      safeToRetry: false,
      recoveryPath: "skipped-stale-worktree",
      reason: expect.stringContaining("workflow state-recovery list"),
    });
  });

  it("continues a preserved claim without changing its worktree lineage", () => {
    writeTask(projectDir, "ready", "task-alpha", "2026-06-27T00:00:00.000Z");
    initializeGitProject();
    expect(
      claimTask(
        claimInput(
          projectDir,
          "task-alpha",
          "run-failed",
          new Date("2026-06-27T01:00:00.000Z"),
        ),
      ),
    ).toMatchObject({ claimed: true });
    const worktree = createAutomationWorktree({
      projectDir,
      taskId: "task-alpha",
      runId: "run-failed",
      workflowId: "builder",
      owner: "workflow:builder",
    });
    updateTaskClaimWorkspace({
      projectDir,
      taskId: "task-alpha",
      runId: "run-failed",
      workflowId: "builder",
      workspaceDir: worktree.metadata.workspaceDir,
      branch: worktree.branch,
      baseCommit: worktree.baseCommit,
      evidence: "prepared failed builder worktree",
    });
    writeFileSync(
      join(worktree.metadata.workspaceDir, "README.md"),
      "# Preserved builder work\n",
      "utf8",
    );
    writeOwnerRunMetadata(projectDir, "run-failed", "builder", "failed");

    const continued = continueTaskClaim({
      projectDir,
      taskId: "task-alpha",
      sourceRunId: "run-failed",
      runId: "run-recovery",
      workflowId: "builder",
      owner: "workflow:builder",
      evidence: "agent recovery accepted preserved work",
      now: new Date("2026-06-27T02:00:00.000Z"),
    });

    expect(continued).toMatchObject({
      claimed: true,
      recoveryPath: "continued-preserved-claim",
      claim: {
        runId: "run-recovery",
        worktreeRunId: "run-failed",
        workspaceDir: worktree.metadata.workspaceDir,
      },
    });
    const historyDir = join(projectDir, ".kota/task-claims/history/task-alpha");
    const historyFiles = readdirSync(historyDir);
    expect(historyFiles).toHaveLength(1);
    const historyFile = historyFiles[0];
    if (historyFile === undefined) throw new Error("continued claim history is missing");
    const historyPath = join(historyDir, historyFile);
    expect(JSON.parse(readFileSync(historyPath, "utf8"))).toMatchObject({
      runId: "run-failed",
      status: "active",
    });
    writeOwnerRunMetadata(projectDir, "run-recovery", "builder", "failed");
    expect(listTaskClaimInspections(projectDir)).toMatchObject([
      {
        claim: {
          runId: "run-recovery",
          worktreeRunId: "run-failed",
        },
        recoveryStatus: "stale",
        safeToRetry: false,
      },
    ]);
    expect(
      releaseTaskClaim({
        projectDir,
        taskId: "task-alpha",
        runId: "run-recovery",
        workflowId: "builder",
        evidence: "recovery merged",
      }),
    ).toMatchObject({ changed: true, recoveryStatus: "released" });
  });

  it("archives a superseded claim and lets a later run replace it", () => {
    writeTask(projectDir, "ready", "task-alpha", "2026-06-27T00:00:00.000Z");
    const original = claimTask(
      claimInput(projectDir, "task-alpha", "run-a", new Date("2026-06-27T01:00:00.000Z")),
    );
    expect(original.claimed).toBe(true);

    const superseded = supersedeTaskClaim({
      projectDir,
      taskId: "task-alpha",
      runId: "run-a",
      workflowId: "builder",
      evidence: "operator superseded stale pending-merge claim",
      now: new Date("2026-06-27T01:00:01.000Z"),
    });
    expect(superseded).toMatchObject({
      changed: true,
      recoveryStatus: "superseded",
      safeToRetry: true,
    });
    expect(existsSync(taskClaimPath(projectDir, "task-alpha"))).toBe(false);

    const replacement = claimTask(
      claimInput(projectDir, "task-alpha", "run-b", new Date("2026-06-27T01:00:02.000Z")),
    );
    expect(replacement).toMatchObject({
      claimed: true,
      recoveryPath: "new-claim",
    });
  });

  it("reports no ordinary queue claim when the only ready task is pending merge", () => {
    writeTask(projectDir, "ready", "task-alpha", "2026-06-27T00:00:00.000Z");
    const original = claimTask(
      claimInput(projectDir, "task-alpha", "run-a", new Date("2026-06-27T01:00:00.000Z")),
    );
    expect(original.claimed).toBe(true);
    markTaskClaimPendingMerge({
      projectDir,
      taskId: "task-alpha",
      runId: "run-a",
      workflowId: "builder",
      evidence: "merge gate is pending",
      now: new Date("2026-06-27T01:00:01.000Z"),
    });

    const result = claimNextQueueTask(
      queueInput(projectDir, "run-b", new Date("2026-06-27T01:00:02.000Z")),
    );

    expect(result).toMatchObject({
      claimed: false,
      taskId: null,
      recoveryPath: "no-actionable-task",
      reason: "all candidate tasks are claimed",
      candidateCount: 1,
    });
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      taskId: "task-alpha",
      recoveryStatus: "pending-merge",
      safeToRetry: false,
      recoveryPath: "skipped-pending-merge",
    });
  });

  it("reserves an exhausted task until decomposition dispositions it", () => {
    writeTask(projectDir, "ready", "task-alpha", "2026-06-27T00:00:00.000Z");
    const original = claimTask(
      claimInput(projectDir, "task-alpha", "run-a", new Date("2026-06-27T01:00:00.000Z")),
    );
    expect(original.claimed).toBe(true);

    const pending = markTaskClaimPendingDecomposition({
      projectDir,
      taskId: "task-alpha",
      runId: "run-a",
      workflowId: "builder",
      evidence: "repair exhausted; awaiting decomposer",
      now: new Date("2026-06-27T01:00:01.000Z"),
    });
    expect(pending).toMatchObject({
      changed: true,
      recoveryStatus: "pending-decomposition",
      safeToRetry: false,
    });

    const result = claimNextQueueTask(
      queueInput(projectDir, "run-b", new Date("2026-06-27T01:00:02.000Z")),
    );
    expect(result).toMatchObject({
      claimed: false,
      reason: "all candidate tasks are claimed",
    });
    expect(result.skipped[0]).toMatchObject({
      taskId: "task-alpha",
      recoveryStatus: "pending-decomposition",
      safeToRetry: false,
      recoveryPath: "skipped-pending-decomposition",
    });
  });
});
