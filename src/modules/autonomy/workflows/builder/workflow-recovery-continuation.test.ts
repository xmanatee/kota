import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import "./workflow-test-support.js";
import builderWorkflow from "./workflow.js";
import {
  makeEmptySnapshot,
  makeSnapshot,
  makeWorkflowProject,
  resetBuilderWorkflowMocks,
} from "./workflow-test-support.js";

describe("builder preserved-work continuation", () => {
  beforeEach(async () => {
    await resetBuilderWorkflowMocks();
  });

  it.each([
    "autonomy.builder.recovery.requested",
    "autonomy.queue.available",
  ])("finishes preserved work through %s", async (event) => {
    const projectDir = makeWorkflowProject(
      event === "autonomy.queue.available"
        ? makeSnapshot(1, 0)
        : makeEmptySnapshot(),
    );
    const taskId = "task-claimed";
    const worktreeRunId = "run-failed";
    const workspaceDir = `${projectDir}/.worktrees/${taskId}-${worktreeRunId}`;
    const recovery = await import(
      "#modules/autonomy/workflow-state-recovery-claims.js"
    );
    const preservedEvidence = await import("./preserved-evidence.js");
    vi.mocked(
      preservedEvidence.findPreservedBuilderEvidenceRunId,
    ).mockReturnValue(worktreeRunId);
    vi.mocked(recovery.listRecoveryClaims).mockReturnValue([
      {
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
      },
    ]);
    const commit = await import("#modules/autonomy/commit.js");
    vi.mocked(commit.commitWorkflowChanges).mockResolvedValue({
      committed: true,
    } as never);

    const result = await new WorkflowTestHarness(builderWorkflow, {
      projectDir,
      trigger: {
        event,
        payload: {
          taskId,
          sourceRunId: worktreeRunId,
          worktreeRunId,
          workspaceDir,
          reason: `preserved builder work from ${worktreeRunId} requires recovery`,
          ...(event === "autonomy.builder.recovery.requested"
            ? { idempotencyKey: `builder-recovery:${worktreeRunId}` }
            : {}),
          branchPerTask: true,
        },
      },
      stepMocks: { build: { turns: [], totalCostUsd: 0.01 } },
    }).run();

    expect(result.status, result.error).toBe("success");
    expect(result.steps["claim-task"].output).toMatchObject({
      claimed: true,
      recoveryPath: "continued-preserved-claim",
    });
    expect(result.steps["prepare-worktree"].output).toMatchObject({
      enabled: true,
      workspaceDir,
      worktreeRunId,
      runtimeResources: {
        agentRunDir: `${workspaceDir}/.kota/builder-evidence/${worktreeRunId}`,
      },
    });
    expect(result.steps["merge-gate"].output).toMatchObject({
      status: "merged",
      runId: worktreeRunId,
    });
    expect(result.steps["release-task-claim"].status).toBe("success");
    expect(result.steps["cleanup-automation-worktree"].status).toBe("success");
  });
});
