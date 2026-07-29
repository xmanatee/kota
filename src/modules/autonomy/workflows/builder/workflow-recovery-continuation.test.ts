import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import "./workflow-test-support.js";
import builderWorkflow from "./workflow.js";
import {
  makeEmptySnapshot,
  makeWorkflowProject,
  resetBuilderWorkflowMocks,
} from "./workflow-test-support.js";

describe("builder preserved-work continuation", () => {
  beforeEach(async () => {
    await resetBuilderWorkflowMocks();
  });

  it("finishes a failed builder worktree through the standard merge pipeline", async () => {
    const projectDir = makeWorkflowProject(makeEmptySnapshot());
    const taskId = "task-claimed";
    const worktreeRunId = "run-failed";
    const workspaceDir = `${projectDir}/.worktrees/${taskId}-${worktreeRunId}`;
    const recovery = await import(
      "#modules/autonomy/workflow-state-recovery-claims.js"
    );
    vi.mocked(recovery.findRecoveryClaim).mockReturnValue({
      claim: {
        taskId,
        taskState: "ready",
        runId: worktreeRunId,
        worktreeRunId,
        workflowId: "builder",
        owner: "workflow:builder",
        workspaceDir,
        branch: `kota/task/${taskId}/${worktreeRunId}`,
        baseCommit: "abc1234",
        status: "active",
        evidence: null,
        updatedAt: "2026-06-27T00:00:00.000Z",
      },
      claimPath: `${projectDir}/.kota/task-claims/active/${taskId}.json`,
      recoveryStatus: "stale",
      safeToRetry: false,
      ownerRunStatus: "failed",
      worktree: {
        found: true,
        metadataPath: `${projectDir}/.kota/worktrees/${taskId}-${worktreeRunId}.json`,
        workspaceDir,
        branch: `kota/task/${taskId}/${worktreeRunId}`,
        state: "active",
        runState: "finished",
        dirtyState: "dirty",
        dirtyEntries: ["M src/recovered.ts"],
        cleanupBlockers: ["worktree has uncommitted tracked changes"],
        mergeStatus: "not merged",
        headCommit: "abc1234",
        uniqueCommits: [],
        uniqueCommitCount: 0,
        branchAhead: 0,
        branchBehind: 0,
      },
      relatedDeadLetters: [],
      recommendedAction: {
        kind: "needs-review",
        reason: "worktree contains preserved uncommitted changes",
      },
    });
    const commit = await import("#modules/autonomy/commit.js");
    vi.mocked(commit.commitWorkflowChanges).mockResolvedValue({
      committed: true,
    } as never);

    const result = await new WorkflowTestHarness(builderWorkflow, {
      projectDir,
      trigger: {
        event: "autonomy.builder.recovery.requested",
        payload: {
          taskId,
          sourceRunId: worktreeRunId,
          worktreeRunId,
          workspaceDir,
          idempotencyKey: `builder-recovery:${worktreeRunId}`,
          reason: "terminal builder preserved workspace changes",
          branchPerTask: true,
        },
      },
      stepMocks: { build: { turns: [], totalCostUsd: 0.01 } },
    }).run();

    expect(result.status).toBe("success");
    expect(result.steps["claim-task"].output).toMatchObject({
      claimed: true,
      recoveryPath: "continued-preserved-claim",
    });
    expect(result.steps["prepare-worktree"].output).toMatchObject({
      enabled: true,
      workspaceDir,
      worktreeRunId,
    });
    expect(result.steps["merge-gate"].output).toMatchObject({
      status: "merged",
      runId: worktreeRunId,
    });
    expect(result.steps["release-task-claim"].status).toBe("success");
    expect(result.steps["cleanup-automation-worktree"].status).toBe("success");
  });
});
