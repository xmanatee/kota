import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import type { WorkflowStateRecoveryClaim } from "#modules/workflow-ops/state-recovery-provider.js";
import "./workflow-test-support.js";
import { listPendingBuilderRecoveries } from "./recovery-continuation.js";
import builderWorkflow from "./workflow.js";
import {
  makeEmptySnapshot,
  makeSnapshot,
  makeWorkflowProject,
  resetBuilderWorkflowMocks,
} from "./workflow-test-support.js";

function preservedRecoveryCandidate(input: {
  projectDir: string;
  taskId: string;
  claimRunId: string;
  worktreeRunId: string;
  workspaceDir: string;
}): WorkflowStateRecoveryClaim {
  return {
    claim: {
      taskId: input.taskId,
      taskState: "ready",
      runId: input.claimRunId,
      worktreeRunId: input.worktreeRunId,
      workflowId: "builder",
      owner: "workflow:builder",
      workspaceDir: input.workspaceDir,
      branch: `kota/task/${input.taskId}/${input.worktreeRunId}`,
      baseCommit: "abc1234",
      status: "active",
      evidence: null,
      updatedAt: "2026-06-27T00:00:00.000Z",
    },
    claimPath: `${input.projectDir}/.kota/task-claims/active/${input.taskId}.json`,
    recoveryStatus: "stale",
    safeToRetry: false,
    ownerRunStatus: "failed",
    worktree: {
      found: true,
      metadataPath: `${input.projectDir}/.kota/worktrees/${input.taskId}-${input.worktreeRunId}.json`,
      workspaceDir: input.workspaceDir,
      branch: `kota/task/${input.taskId}/${input.worktreeRunId}`,
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
  };
}

describe("builder preserved-work continuation", () => {
  beforeEach(async () => {
    await resetBuilderWorkflowMocks();
  });

  it.each([
    {
      label: "an automatic recovery request",
      event: "autonomy.builder.recovery.requested",
      boundedContinuation: false,
    },
    {
      label: "ordinary queue dispatch",
      event: "autonomy.queue.available",
      boundedContinuation: false,
    },
    {
      label: "an explicit retry after the automatic continuation bound",
      event: "autonomy.builder.recovery.requested",
      boundedContinuation: true,
    },
  ])("finishes preserved work through $label", async ({ event, boundedContinuation }) => {
    const projectDir = makeWorkflowProject(
      event === "autonomy.queue.available"
        ? makeSnapshot(1, 0)
        : makeEmptySnapshot(),
    );
    const taskId = "task-claimed";
    const worktreeRunId = "run-failed";
    const claimRunId = boundedContinuation ? "run-failed-continuation" : worktreeRunId;
    const workspaceDir = `${projectDir}/.worktrees/${taskId}-${worktreeRunId}`;
    const recovery = await import(
      "#modules/autonomy/workflow-state-recovery-claims.js"
    );
    const preservedEvidence = await import("./preserved-evidence.js");
    vi.mocked(
      preservedEvidence.findPreservedBuilderEvidenceRunId,
    ).mockReturnValue(worktreeRunId);
    vi.mocked(recovery.listRecoveryClaims).mockReturnValue([
      preservedRecoveryCandidate({
        projectDir,
        taskId,
        claimRunId,
        worktreeRunId,
        workspaceDir,
      }),
    ]);
    if (boundedContinuation) {
      const finalizerDir = join(projectDir, ".kota", "runs", claimRunId);
      mkdirSync(finalizerDir, { recursive: true });
      writeFileSync(
        join(finalizerDir, "terminal-worktree-finalizer.json"),
        JSON.stringify({ recoveryRequested: false }),
      );
      expect(listPendingBuilderRecoveries(projectDir)).toEqual([]);
    }
    const commit = await import("#modules/autonomy/commit.js");
    vi.mocked(commit.commitWorkflowChanges).mockResolvedValue({
      committed: true,
      committedPaths: ["src/recovered.ts"],
      daemonRestartRequired: false,
      message: "Recover preserved builder work",
      sha: "abc1234",
    });

    const result = await new WorkflowTestHarness(builderWorkflow, {
      projectDir,
      trigger: {
        event,
        payload: {
          taskId,
          sourceRunId: claimRunId,
          worktreeRunId,
          workspaceDir,
          reason: `preserved builder work from ${worktreeRunId} requires recovery`,
          ...(event === "autonomy.builder.recovery.requested"
            ? { idempotencyKey: `builder-recovery:${worktreeRunId}` }
            : {}),
          ...(boundedContinuation ? { retryOf: claimRunId } : {}),
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

  it("ignores a recovery request after claim ownership advances", async () => {
    const projectDir = makeWorkflowProject(makeEmptySnapshot());
    const taskId = "task-claimed";
    const worktreeRunId = "run-failed";
    const workspaceDir = `${projectDir}/.worktrees/${taskId}-${worktreeRunId}`;
    const recovery = await import(
      "#modules/autonomy/workflow-state-recovery-claims.js"
    );
    vi.mocked(recovery.listRecoveryClaims).mockReturnValue([
      preservedRecoveryCandidate({
        projectDir,
        taskId,
        claimRunId: "run-new-owner",
        worktreeRunId,
        workspaceDir,
      }),
    ]);

    const result = await new WorkflowTestHarness(builderWorkflow, {
      projectDir,
      trigger: {
        event: "autonomy.builder.recovery.requested",
        payload: {
          taskId,
          sourceRunId: "run-stale-owner",
          worktreeRunId,
          workspaceDir,
          idempotencyKey: "builder-recovery:run-stale-owner",
          reason: "stale preserved-work request",
        },
      },
    }).run();

    expect(result.status, result.error).toBe("success");
    expect(result.steps["claim-task"].output).toMatchObject({
      claimed: false,
      recoveryPath: "no-actionable-task",
    });
    expect(result.steps.build.status).toBe("skipped");
  });
});
