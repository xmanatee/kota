import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  WorkflowBlockingOperation,
  WorkflowBlockingOperationRunner,
} from "#core/workflow/blocking-operation.js";
import type { WorkflowTerminalFinalizerInput } from "#core/workflow/types.js";

const {
  inspectAutomationWorktree,
  listAutomationWorktreeUniqueCommits,
  reconcileAutomationWorktrees,
} = vi.hoisted(() => ({
  inspectAutomationWorktree: vi.fn(),
  listAutomationWorktreeUniqueCommits: vi.fn(),
  reconcileAutomationWorktrees: vi.fn(),
}));
const { releaseBuilderPortRange } = vi.hoisted(() => ({
  releaseBuilderPortRange: vi.fn().mockResolvedValue({ released: true }),
}));
const { findRecoveryClaim } = vi.hoisted(() => ({
  findRecoveryClaim: vi.fn(),
}));
const { markTaskClaimPendingDecomposition, releaseTaskClaim } = vi.hoisted(() => ({
  markTaskClaimPendingDecomposition: vi.fn(),
  releaseTaskClaim: vi.fn(),
}));

vi.mock("#modules/git/worktree-lifecycle.js", () => ({
  inspectAutomationWorktree,
  listAutomationWorktreeUniqueCommits,
  reconcileAutomationWorktrees,
}));
vi.mock("./runtime-resource-ports.js", () => ({ releaseBuilderPortRange }));
vi.mock("#modules/autonomy/workflow-state-recovery-claims.js", () => ({
  findRecoveryClaim,
}));
vi.mock("#modules/autonomy/task-claims.js", () => ({
  markTaskClaimPendingDecomposition,
  releaseTaskClaim,
}));

import { finalizeBuilderTerminalWorktree } from "./terminal-worktree-finalizer.js";
import {
  type BuilderTerminalWorktreeOperationInput,
  builderTerminalWorktreeFinalizerOperation,
  runBuilderTerminalWorktreeFinalizerInWorker,
} from "./terminal-worktree-finalizer-operation.js";

const tempDirs: string[] = [];

async function runBlockingInline<TInput, TOutput>(
  operation: WorkflowBlockingOperation<TInput, TOutput>,
  input: TInput,
): Promise<TOutput> {
  expect(operation).toBe(builderTerminalWorktreeFinalizerOperation);
  const output = await runBuilderTerminalWorktreeFinalizerInWorker(
    input as BuilderTerminalWorktreeOperationInput,
  );
  return output as TOutput;
}

afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function finalizerInput(status: "success" | "failed"): WorkflowTerminalFinalizerInput {
  const projectDir = mkdtempSync(join(tmpdir(), "builder-finalizer-"));
  tempDirs.push(projectDir);
  return {
    projectDir,
    workspaceDir: projectDir,
    metadata: {
      id: "builder-run",
      workflow: "builder",
      status,
      runDir: ".kota/runs/builder-run",
      steps: [
        {
          id: "prepare-worktree",
          output: {
            enabled: true,
            taskId: "task-one",
            runtimeResources: { profileId: "task-one:builder-run" },
          },
        },
      ],
    } as WorkflowTerminalFinalizerInput["metadata"],
    trigger: {
      event: "task.ready",
      schemaRef: null,
      payload: {},
    },
    emit: vi.fn(),
    log: vi.fn(),
    runBlocking: runBlockingInline satisfies WorkflowBlockingOperationRunner["runBlocking"],
  };
}

describe("finalizeBuilderTerminalWorktree", () => {
  it("does nothing for a builder run without an automation worktree", async () => {
    const input = finalizerInput("success");
    const prepareStep = input.metadata.steps.find((step) => step.id === "prepare-worktree");
    if (prepareStep === undefined) throw new Error("prepare-worktree fixture is missing");
    prepareStep.output = { enabled: false, taskId: "task-one" };

    await finalizeBuilderTerminalWorktree(input);

    expect(inspectAutomationWorktree).not.toHaveBeenCalled();
    expect(reconcileAutomationWorktrees).not.toHaveBeenCalled();
  });

  it("reconciles a successful pending-merge run", async () => {
    inspectAutomationWorktree.mockReturnValue({
      branch: "kota/task-one",
      headCommit: "abc123",
      metadata: {
        state: "pending-merge",
        runtimeResources: { profileId: "task-one:builder-run" },
      },
      cleanup: { blockers: ["worktree is pending merge"] },
    });
    listAutomationWorktreeUniqueCommits.mockReturnValue({
      commits: ["abc123"],
    });
    reconcileAutomationWorktrees.mockReturnValue({
      items: [
        {
          taskId: "task-one",
          runId: "builder-run",
          removed: false,
          blockers: ["worktree is pending merge"],
        },
      ],
    });
    const input = finalizerInput("success");

    await finalizeBuilderTerminalWorktree(input);

    expect(reconcileAutomationWorktrees).toHaveBeenCalledWith(input.projectDir);
    const artifact = JSON.parse(
      readFileSync(
        join(input.projectDir, input.metadata.runDir, "terminal-worktree-finalizer.json"),
        "utf8",
      ),
    ) as { removed: boolean; uniqueCommits: string[]; portLeaseReleased: boolean };
    expect(artifact).toMatchObject({
      removed: false,
      uniqueCommits: ["abc123"],
      portLeaseReleased: true,
      claimDisposition: "preserved",
    });
    expect(releaseTaskClaim).not.toHaveBeenCalled();
  });

  it("releases the claim after a clean terminal worktree is removed", async () => {
    inspectAutomationWorktree.mockReturnValue({
      branch: "kota/task-one",
      headCommit: "abc123",
      metadata: {
        state: "active",
        runtimeResources: { profileId: "task-one:builder-run" },
      },
      cleanup: { blockers: [] },
    });
    listAutomationWorktreeUniqueCommits.mockReturnValue({ commits: [] });
    reconcileAutomationWorktrees.mockReturnValue({
      items: [
        {
          taskId: "task-one",
          runId: "builder-run",
          removed: true,
          blockers: [],
        },
      ],
    });
    releaseTaskClaim.mockReturnValue({
      taskId: "task-one",
      changed: true,
      claim: null,
      recoveryStatus: "released",
      safeToRetry: true,
      reason: null,
    });
    const input = finalizerInput("failed");

    await finalizeBuilderTerminalWorktree(input);

    expect(releaseTaskClaim).toHaveBeenCalledWith({
      projectDir: input.projectDir,
      taskId: "task-one",
      runId: "builder-run",
      workflowId: "builder",
      evidence: "terminal builder run builder-run left no preserved worktree",
    });
    expect(
      JSON.parse(
        readFileSync(
          join(input.projectDir, input.metadata.runDir, "terminal-worktree-finalizer.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      removed: true,
      claimDisposition: "released",
      recoveryAction: { kind: "none" },
    });
  });

  it("reserves an exhausted clean task for decomposition", async () => {
    inspectAutomationWorktree.mockReturnValue({
      branch: "kota/task-one",
      headCommit: "abc123",
      metadata: {
        state: "active",
        runtimeResources: { profileId: "task-one:builder-run" },
      },
      cleanup: { blockers: [] },
    });
    listAutomationWorktreeUniqueCommits.mockReturnValue({ commits: [] });
    reconcileAutomationWorktrees.mockReturnValue({
      items: [
        {
          taskId: "task-one",
          runId: "builder-run",
          removed: true,
          blockers: [],
        },
      ],
    });
    markTaskClaimPendingDecomposition.mockReturnValue({
      taskId: "task-one",
      changed: true,
      claim: null,
      recoveryStatus: "pending-decomposition",
      safeToRetry: false,
      reason: null,
    });
    const input = finalizerInput("failed");
    input.metadata.steps.push({
      id: "build",
      type: "agent",
      status: "failed",
      errorKind: "repair-no-progress",
      startedAt: "2026-08-03T13:00:00.000Z",
      completedAt: "2026-08-03T13:01:00.000Z",
      durationMs: 60_000,
    });

    await finalizeBuilderTerminalWorktree(input);

    expect(markTaskClaimPendingDecomposition).toHaveBeenCalledWith({
      projectDir: input.projectDir,
      taskId: "task-one",
      runId: "builder-run",
      workflowId: "builder",
      evidence:
        "terminal builder run builder-run repair-exhausted; awaiting decomposer disposition",
    });
    expect(releaseTaskClaim).not.toHaveBeenCalled();
    expect(
      JSON.parse(
        readFileSync(
          join(input.projectDir, input.metadata.runDir, "terminal-worktree-finalizer.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      removed: true,
      claimDisposition: "pending-decomposition",
      recoveryAction: { kind: "decomposition-pending" },
    });
  });

});
