import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type AgentHarness,
	clearAgentHarnessRegistryForTest,
	registerAgentHarness,
} from "#core/agent-harness/index.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import type { WorkflowStateRecoveryClaim } from "#modules/workflow-ops/state-recovery-provider.js";
import "./workflow-test-support.js";
import builderWorkflow from "./workflow.js";
import {
  makeEmptySnapshot,
  makeWorkflowProject,
  resetBuilderWorkflowMocks,
} from "./workflow-test-support.js";

function preservedRecoveryCandidate(input: {
  projectDir: string;
  taskId: string;
  runId: string;
  workspaceDir: string;
}): WorkflowStateRecoveryClaim {
  const branch = `kota/task/${input.taskId}/${input.runId}`;
  return {
    claim: {
      taskId: input.taskId,
      taskState: "ready",
      runId: input.runId,
      worktreeRunId: input.runId,
      workflowId: "builder",
      owner: "workflow:builder",
      workspaceDir: input.workspaceDir,
      branch,
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
      metadataPath: `${input.projectDir}/.kota/worktrees/${input.taskId}-${input.runId}.json`,
      workspaceDir: input.workspaceDir,
      branch,
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

describe("builder preserved-work canonical reconciliation", () => {
  beforeEach(async () => {
	const harness: AgentHarness = {
		name: "codex",
		description: "canonical reconciliation workflow fixture",
		supportsMultiTurn: true,
		supportedHookKinds: [],
		askOwnerToolName: null,
		emitsAgentMessageStream: false,
		toolControl: "kota",
		run: async () => ({ text: "unused", streamedText: "", turns: 1, isError: false }),
	};
	registerAgentHarness(harness);
    await resetBuilderWorkflowMocks();
  });
	afterEach(() => {
		clearAgentHarnessRegistryForTest();
	});

  it("holds failed reconciliation for review without starting the builder", async () => {
    const projectDir = makeWorkflowProject(makeEmptySnapshot());
	mkdirSync(projectDir, { recursive: true });
    const taskId = "task-claimed";
    const runId = "run-failed";
    const workspaceDir = `${projectDir}/.worktrees/${taskId}-${runId}`;
    const agentRunDir = join(
      workspaceDir,
      ".kota",
      "builder-evidence",
      runId,
    );
    mkdirSync(agentRunDir, { recursive: true });
    writeFileSync(
      join(agentRunDir, "success-criteria.txt"),
      "1. Reconcile preserved work.\n",
    );
    writeFileSync(
      join(agentRunDir, "evidence-manifest.json"),
      '{"schemaVersion":1,"artifacts":[]}\n',
    );
    const recovery = await import(
      "#modules/autonomy/workflow-state-recovery-claims.js"
    );
    vi.mocked(recovery.listRecoveryClaims).mockReturnValue([
      preservedRecoveryCandidate({ projectDir, taskId, runId, workspaceDir }),
    ]);
    const reconciliation = await import(
      "#modules/git/worktree-canonical-reconciliation.js"
    );
    vi.mocked(
      reconciliation.checkpointAndReconcileAutomationWorktree,
    ).mockImplementationOnce((input) => {
      const record = {
        phase: "conflict-blocked" as const,
        disposition: "needs-review" as const,
        originalBaseCommit: "abc1234",
        checkpointCommit: "checkpoint123",
        canonicalHeadCommit: "canonical123",
        integratedCanonicalHeadCommit: null,
        branchBehindAtStart: 2,
        branchBehindAtResume: null,
        overlappingPaths: ["src/shared.ts"],
        canonicalDestructivePaths: [],
        conflicts: [
          {
            path: "src/shared.ts",
            kind: "text" as const,
            reason: "text conflict can be resolved by a bounded resolver",
          },
        ],
        validations: [],
        reason: "fixture resolver refused ambiguous intent",
        artifactPath: input.artifactPath,
        updatedAt: "2026-08-15T00:00:00.000Z",
      };
      input.onProgress(record);
      return Promise.resolve(record);
    });

    const result = await new WorkflowTestHarness(builderWorkflow, {
      projectDir,
      trigger: {
        event: "autonomy.builder.recovery.requested",
        payload: {
          taskId,
          sourceRunId: runId,
          worktreeRunId: runId,
          workspaceDir,
          idempotencyKey: `builder-recovery:${runId}`,
          reason: "preserved work needs canonical reconciliation",
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
		taskId,
		worktreeRunId: runId,
	});
    expect(result.steps["reconcile-preserved-canonical"]).toMatchObject({
		status: "success",
		output: {
			disposition: "needs-review",
			checkpointCommit: "checkpoint123",
			conflicts: [{ path: "src/shared.ts" }],
		},
	});
    expect(result.steps.build.status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
    const claims = await import("#modules/autonomy/task-claims.js");
    expect(claims.markTaskClaimPendingMerge).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId,
        runId: "harness-run-id",
        evidence: expect.stringContaining("fixture resolver refused ambiguous intent"),
      }),
    );
	rmSync(projectDir, { recursive: true, force: true });
  });
});
