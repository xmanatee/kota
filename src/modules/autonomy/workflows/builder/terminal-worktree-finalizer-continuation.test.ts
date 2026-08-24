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

function finalizerInput(): WorkflowTerminalFinalizerInput {
  const projectDir = mkdtempSync(join(tmpdir(), "builder-finalizer-continuation-"));
  tempDirs.push(projectDir);
  return {
    projectDir,
    workspaceDir: projectDir,
    metadata: {
      id: "builder-run",
      workflow: "builder",
      status: "failed",
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

function continuedFinalizerInput(): WorkflowTerminalFinalizerInput {
  const input = finalizerInput();
  input.metadata.id = "recovery-run";
  input.metadata.runDir = ".kota/runs/recovery-run";
  const prepareStep = input.metadata.steps.find((step) => step.id === "prepare-worktree");
  if (prepareStep === undefined) throw new Error("prepare-worktree fixture is missing");
  prepareStep.output = {
    enabled: true,
    taskId: "task-one",
    worktreeRunId: "builder-run",
  };
  input.trigger.event = "autonomy.builder.recovery.requested";
  return input;
}

function setContinuationDecision(
  input: WorkflowTerminalFinalizerInput,
  decision: "decompose" | "preserve-yield" | "needs-owner",
): void {
  if (decision === "preserve-yield") {
    input.metadata.status = "yielded";
  }
  input.metadata.steps.push({
    id: "build",
    type: "agent",
    status: decision === "preserve-yield" ? "yielded" : "failed",
    ...(decision === "decompose"
      ? { errorKind: "repair-decompose" as const }
      : decision === "needs-owner"
        ? { errorKind: "repair-needs-owner" as const }
        : {}),
    output: {
      continuationDecisions: [
        {
          decision,
          evidenceKey: `${decision}-boundary`,
          summary: `${decision} summary`,
          nextAction: `${decision} next action`,
        },
      ],
    },
  } as WorkflowTerminalFinalizerInput["metadata"]["steps"][number]);
}

function mockPreservedWorktree(input: {
  claimRunId: string;
  dirtyState: "dirty" | "conflicted";
  blocker: string;
}): void {
  inspectAutomationWorktree.mockReturnValue({
    branch: "kota/task-one",
    headCommit: "abc123",
    metadata: {
      state: "active",
      ...(input.claimRunId !== "builder-run"
        ? { recoveryRunId: input.claimRunId }
        : {}),
      runtimeResources: { profileId: `task-one:${input.claimRunId}` },
    },
    cleanup: { blockers: [input.blocker] },
  });
  listAutomationWorktreeUniqueCommits.mockReturnValue({ commits: [] });
  reconcileAutomationWorktrees.mockReturnValue({
    items: [
      {
        taskId: "task-one",
        runId: "builder-run",
        removed: false,
        blockers: [input.blocker],
      },
    ],
  });
  findRecoveryClaim.mockReturnValue({
    claim: {
      taskId: "task-one",
      runId: input.claimRunId,
      worktreeRunId: "builder-run",
      workflowId: "builder",
    },
    ownerRunStatus: "failed",
    worktree: {
      found: true,
      dirtyState: input.dirtyState,
      workspaceDir: "/tmp/preserved-builder",
    },
    recommendedAction: {
      kind: "needs-review",
      reason: input.blocker,
    },
  });
}

describe("finalizeBuilderTerminalWorktree continuations", () => {
  it("requests one continuation for terminal preserved changes", async () => {
    mockPreservedWorktree({
      claimRunId: "builder-run",
      dirtyState: "dirty",
      blocker: "worktree has uncommitted tracked changes",
    });
    const input = finalizerInput();

    await finalizeBuilderTerminalWorktree(input);

    expect(input.emit).toHaveBeenCalledWith(
      "autonomy.builder.recovery.requested",
      expect.objectContaining({
        taskId: "task-one",
        sourceRunId: "builder-run",
        worktreeRunId: "builder-run",
      }),
    );
    expect(releaseTaskClaim).not.toHaveBeenCalled();
  });

  it("preserves an ambiguous continuation without dispatching another", async () => {
    mockPreservedWorktree({
      claimRunId: "recovery-run",
      dirtyState: "conflicted",
      blocker: "worktree has conflicted paths",
    });
    const input = continuedFinalizerInput();

    await finalizeBuilderTerminalWorktree(input);

    expect(input.emit).not.toHaveBeenCalled();
    expect(
      JSON.parse(
        readFileSync(
          join(input.projectDir, input.metadata.runDir, "terminal-worktree-finalizer.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      removed: false,
      blockers: ["worktree has conflicted paths"],
      recoveryRequested: false,
    });
  });

  it("preserves a deliberate yield without immediately reclaiming the agent slot", async () => {
    mockPreservedWorktree({
      claimRunId: "builder-run",
      dirtyState: "dirty",
      blocker: "worktree has checkpointed changes",
    });
    const input = finalizerInput();
    setContinuationDecision(input, "preserve-yield");

    await finalizeBuilderTerminalWorktree(input);

    expect(input.emit).not.toHaveBeenCalled();
    expect(
      JSON.parse(
        readFileSync(
          join(
            input.projectDir,
            input.metadata.runDir,
            "terminal-worktree-finalizer.json",
          ),
          "utf8",
        ),
      ),
    ).toMatchObject({
      removed: false,
      recoveryRequested: true,
      continuationDecision: "preserve-yield",
      claimDisposition: "preserved",
      recoveryAction: { kind: "priority-yield" },
    });
    expect(markTaskClaimPendingDecomposition).not.toHaveBeenCalled();
    expect(releaseTaskClaim).not.toHaveBeenCalled();
  });

  it("retries a continuation only after a classified provider failure", async () => {
    mockPreservedWorktree({
      claimRunId: "recovery-run",
      dirtyState: "dirty",
      blocker: "worktree has uncommitted tracked changes",
    });
    const input = continuedFinalizerInput();
    input.agentFailureKind = "provider";

    await finalizeBuilderTerminalWorktree(input);

    expect(input.emit).toHaveBeenCalledTimes(1);
    expect(input.emit).toHaveBeenCalledWith(
      "autonomy.builder.recovery.requested",
      expect.objectContaining({
        sourceRunId: "recovery-run",
        worktreeRunId: "builder-run",
      }),
    );
  });
});
