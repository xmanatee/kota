import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import type { WorkflowStateRecoveryClaim } from "#modules/workflow-ops/state-recovery-provider.js";
import "./workflow-test-support.js";
import {
  claimPendingBuilderRecovery,
  listPendingBuilderRecoveries,
} from "./recovery-continuation.js";
import builderWorkflow from "./workflow.js";
import {
  makeEmptySnapshot,
  makeSnapshot,
  makeWorkflowProject,
  resetBuilderWorkflowMocks,
} from "./workflow-test-support.js";

const CITED_APPLE_TASK_ID =
  "task-render-shared-ui-surfaces-in-apple-clients";
const CITED_FAILED_CONTINUATION_RUN_ID =
  "2026-08-23T17-26-21-807Z-builder-8knpd4";
const CITED_PRESERVED_WORKTREE_RUN_ID =
  "2026-08-23T15-12-13-058Z-builder-s82ppl";

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

function writeIncompletePreservedEvidence(
  workspaceDir: string,
  runId: string,
): string {
  const agentRunDir = join(
    workspaceDir,
    ".kota",
    "builder-evidence",
    runId,
  );
  mkdirSync(agentRunDir, { recursive: true });
  writeFileSync(
    join(agentRunDir, "success-criteria.txt"),
    "1. Finish preserved work.\n",
  );
  writeFileSync(
    join(agentRunDir, "evidence-manifest.json"),
    '{"schemaVersion":1,"artifacts":[]}\n',
  );
  return agentRunDir;
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
      label: "an explicit retry after the automatic continuation bound",
      event: "autonomy.builder.recovery.requested",
      boundedContinuation: true,
    },
  ])("finishes preserved work through $label", async ({ event, boundedContinuation }) => {
    const projectDir = makeWorkflowProject(makeEmptySnapshot());
    const taskId = CITED_APPLE_TASK_ID;
    const worktreeRunId = CITED_PRESERVED_WORKTREE_RUN_ID;
    const claimRunId = boundedContinuation
      ? `${CITED_FAILED_CONTINUATION_RUN_ID}-redrive`
      : CITED_FAILED_CONTINUATION_RUN_ID;
    const workspaceDir = `${projectDir}/.worktrees/${taskId}-${worktreeRunId}`;
    const agentRunDir = writeIncompletePreservedEvidence(
      workspaceDir,
      worktreeRunId,
    );
    const recovery = await import(
      "#modules/autonomy/workflow-state-recovery-claims.js"
    );
    const claims = await import("#modules/autonomy/task-claims.js");
    vi.mocked(claims.continueTaskClaim).mockImplementationOnce((input) => ({
      claimed: true,
      taskId,
      claim: {
        schemaVersion: 2,
        taskId,
        taskState: "ready",
        taskFile: {
          path: `data/tasks/ready/${taskId}.md`,
          snapshot: {
            dev: 1,
            ino: 1,
            size: 1,
            mtimeMs: 1,
            ctimeMs: 1,
          },
        },
        runId: input.runId,
        worktreeRunId,
        workflowId: "builder",
        owner: "workflow:builder",
        workspaceDir,
        branch: `kota/task/${taskId}/${worktreeRunId}`,
        baseCommit: "abc1234",
        leaseMs: 25_200_000,
        leaseAcquiredAt: "2026-06-27T00:00:00.000Z",
        leaseExpiresAt: "2026-06-27T07:00:00.000Z",
        createdAt: "2026-06-27T00:00:00.000Z",
        updatedAt: "2026-06-27T00:00:01.000Z",
        status: "active",
        evidence: input.evidence,
      },
      recoveryStatus: "agent-running",
      safeToRetry: false,
      recoveryPath: "continued-preserved-claim",
      reason: null,
    }));
    const agentWriteScope = await import(
      "#core/workflow/steps/agent-write-scope.js"
    );
    vi.mocked(agentWriteScope.listWorkflowMutatedPaths).mockReturnValue([
      `data/tasks/done/${taskId}.md`,
    ]);
    const runSummary = await import("./run-summary.js");
    vi.mocked(runSummary.findTerminalTaskInChangedFiles).mockReturnValue({
      taskId,
      taskTitle: "Render shared UI surfaces in Apple clients",
    });
    vi.mocked(runSummary.findTerminalTasksInChangedFiles).mockReturnValue([
      {
        file: `data/tasks/done/${taskId}.md`,
        taskId,
        taskTitle: "Render shared UI surfaces in Apple clients",
        becameTerminal: true,
      },
    ]);
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
    expect(result.steps.build.status).toBe("success");
    expect(existsSync(join(agentRunDir, "success-criteria-verified.txt"))).toBe(
      false,
    );
    expect(existsSync(join(agentRunDir, "commit-message.txt"))).toBe(false);
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

  it("continues a claim owner proven by the recovery retry lineage", async () => {
    const projectDir = makeWorkflowProject(makeEmptySnapshot());
    const taskId = "task-claimed";
    const claimRunId = "run-current-claim-owner";
    const failedRedriveRunId = "run-failed-redrive";
    const worktreeRunId = "run-preserved-worktree";
    const workspaceDir = `${projectDir}/.worktrees/${taskId}-${worktreeRunId}`;
    const failedRedriveDir = join(
      projectDir,
      ".kota",
      "runs",
      failedRedriveRunId,
    );
    mkdirSync(failedRedriveDir, { recursive: true });
    writeFileSync(
      join(failedRedriveDir, "metadata.json"),
      JSON.stringify({
        id: failedRedriveRunId,
        workflow: "builder",
        retryOf: claimRunId,
      }),
    );
    const recovery = await import(
      "#modules/autonomy/workflow-state-recovery-claims.js"
    );
    vi.mocked(recovery.listRecoveryClaims).mockReturnValue([
      preservedRecoveryCandidate({
        projectDir,
        taskId,
        claimRunId,
        worktreeRunId,
        workspaceDir,
      }),
    ]);

    const result = claimPendingBuilderRecovery({
      projectDir,
      trigger: {
        event: "autonomy.builder.recovery.requested",
        schemaRef: null,
        payload: {
          taskId,
          sourceRunId: "run-original-request",
          worktreeRunId,
          workspaceDir,
          retryOf: failedRedriveRunId,
        },
      },
      workflow: {
        name: "builder",
        definitionPath: "test",
        runId: "run-current-redrive",
        runDir: ".kota/runs/run-current-redrive",
        runDirPath: `${projectDir}/.kota/runs/run-current-redrive`,
      },
    });

    expect(result).toMatchObject({
      claimed: true,
      taskId,
      claim: { runId: "run-current-redrive" },
      recoveryPath: "continued-preserved-claim",
    });
    const claims = await import("#modules/autonomy/task-claims.js");
    expect(claims.continueTaskClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId,
        sourceRunId: claimRunId,
        runId: "run-current-redrive",
      }),
    );
  });

  it("keeps preserved claims out of ordinary queue dispatch", async () => {
    const projectDir = makeWorkflowProject(makeSnapshot(1, 0));
    const recovery = await import(
      "#modules/autonomy/workflow-state-recovery-claims.js"
    );

    const result = claimPendingBuilderRecovery({
      projectDir,
      trigger: {
        event: "autonomy.queue.available",
        schemaRef: null,
        payload: {},
      },
      workflow: {
        name: "builder",
        definitionPath: "test",
        runId: "run-ordinary",
        runDir: ".kota/runs/run-ordinary",
        runDirPath: `${projectDir}/.kota/runs/run-ordinary`,
      },
    });

    expect(result).toBeNull();
    expect(recovery.listRecoveryClaims).not.toHaveBeenCalled();
  });
});
