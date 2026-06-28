import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import "./workflow-test-support.js";
import builderWorkflow from "./workflow.js";
import {
  makeSnapshot,
  makeWorkflowProject,
  resetBuilderWorkflowMocks,
} from "./workflow-test-support.js";

describe("builder workflow worktree mode", () => {
  beforeEach(async () => {
    await resetBuilderWorkflowMocks();
  });

  it("prepares a task worktree and runs build and commit inside it", async () => {
    const snapshot = makeSnapshot(1, 0);
    const projectDir = makeWorkflowProject(snapshot);
    const expectedWorkspaceDir = `${projectDir}/.worktrees/task-claimed-harness-run-id`;
    let buildWorkspaceDir: string | undefined;
    let buildRuntimeProfileId: string | undefined;
    let buildRuntimePortBase: string | undefined;

    const { loadConfig } = await import("#core/config/config.js");
    vi.mocked(loadConfig).mockReturnValue({
      modules: { builder: { branchPerTask: true } },
    });

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const harness = new WorkflowTestHarness(builderWorkflow, {
      projectDir,
      trigger: {
        event: "autonomy.queue.available",
        payload: {
          pullableCount: 1,
          actionableCount: 1,
          counts: snapshot.counts,
          branchPerTask: true,
          prUrl: "https://github.com/org/repo/pull/42",
        },
      },
      stepMocks: {
        build: (ctx) => {
          buildWorkspaceDir = ctx.workspaceDir;
          buildRuntimeProfileId = ctx.runtimeResources?.profileId;
          buildRuntimePortBase = ctx.runtimeResources?.env.KOTA_PORT_BASE;
          return { turns: [], totalCostUsd: 0.05 };
        },
      },
    });

    const result = await harness.run();
    const prepareOutput = result.steps["prepare-worktree"].output as {
      runtimeResources: {
        profileId: string;
        tempRoot: string;
        artifactRoot: string;
        ports: { start: number; end: number; size: number };
        env: Record<string, string>;
      };
    };

    expect(result.status).toBe("success");
    expect(result.steps["prepare-worktree"].output).toMatchObject({
      enabled: true,
      projectDir,
      workspaceDir: expectedWorkspaceDir,
      branch: "kota/task/task-claimed/harness-run-id",
      baseCommit: "abc1234",
      headCommit: "abc1234",
      taskId: "task-claimed",
      claimId: "task-claimed:harness-run-id",
      runtimeResources: {
        profileId: "task-claimed:harness-run-id",
        workspaceDir: expectedWorkspaceDir,
        tempRoot: `${expectedWorkspaceDir}/.kota/tmp/harness-run-id`,
        artifactRoot: `${projectDir}/.kota/runs/harness/artifacts`,
        ports: { size: 20 },
        env: {
          KOTA_RUNTIME_PROFILE_ID: "task-claimed:harness-run-id",
          KOTA_WORKSPACE_DIR: expectedWorkspaceDir,
        },
      },
    });
    expect(buildWorkspaceDir).toBe(expectedWorkspaceDir);
    expect(buildRuntimeProfileId).toBe("task-claimed:harness-run-id");
    expect(buildRuntimePortBase).toBe(String(prepareOutput.runtimeResources.ports.start));
    expect(commitWorkflowChanges).toHaveBeenCalledWith(
      expectedWorkspaceDir,
      `${projectDir}/.kota/runs/harness`,
    );

    const { mergeAutomationWorktree } = await import("#modules/git/worktree-merge-gate.js");
    expect(mergeAutomationWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        projectDir,
        taskId: "task-claimed",
        runId: "harness-run-id",
        validationCommand: ["pnpm", "test", "src/modules/git", "src/modules/autonomy/workflows/builder"],
        resolver: expect.any(Function),
        maxResolutionAttempts: 2,
      }),
    );

    const { releaseTaskClaim } = await import("#modules/autonomy/task-claims.js");
    expect(releaseTaskClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        projectDir,
        taskId: "task-claimed",
        runId: "harness-run-id",
        workflowId: "builder",
      }),
    );
    expect(vi.mocked(mergeAutomationWorktree).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(releaseTaskClaim).mock.invocationCallOrder[0],
    );

    const { cleanupAutomationWorktree } = await import("#modules/git/worktree-lifecycle.js");
    expect(cleanupAutomationWorktree).toHaveBeenCalledWith({
      projectDir,
      taskId: "task-claimed",
      runId: "harness-run-id",
    });
    expect(result.steps["write-parallel-builder-metrics"].status).toBe("success");
    expect(result.steps["write-parallel-builder-metrics"].output).toMatchObject({
      workspaceMode: "worktree",
      waitMs: 12,
      mergeDurationMs: 34,
      cleanupOutcome: "removed",
      mergeGateArtifactPath: `${projectDir}/.kota/worktrees/task-claimed-harness-run-id.merge-gate.json`,
    });
    expect(result.steps["create-pr"].status).toBe("skipped");

    const { createAutomationWorktree } = await import("#modules/git/worktree-lifecycle.js");
    expect(createAutomationWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        projectDir,
        taskId: "task-claimed",
        runId: "harness-run-id",
        workflowId: "builder",
        owner: "workflow:builder",
        baseRef: "abc1234",
      }),
    );

    const { updateAutomationWorktreeRuntimeResources } =
      await import("#modules/git/worktree-lifecycle.js");
    expect(updateAutomationWorktreeRuntimeResources).toHaveBeenCalledWith(
      { projectDir, taskId: "task-claimed", runId: "harness-run-id" },
      expect.objectContaining({
        profileId: "task-claimed:harness-run-id",
        tempRoot: prepareOutput.runtimeResources.tempRoot,
        artifactRoot: prepareOutput.runtimeResources.artifactRoot,
        ports: expect.objectContaining({
          start: prepareOutput.runtimeResources.ports.start,
          end: prepareOutput.runtimeResources.ports.end,
        }),
      }),
    );

    const { updateTaskClaimWorkspace } = await import("#modules/autonomy/task-claims.js");
    expect(updateTaskClaimWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        projectDir,
        taskId: "task-claimed",
        runId: "harness-run-id",
        workflowId: "builder",
        workspaceDir: expectedWorkspaceDir,
        branch: "kota/task/task-claimed/harness-run-id",
        baseCommit: "abc1234",
      }),
    );
  });
});
