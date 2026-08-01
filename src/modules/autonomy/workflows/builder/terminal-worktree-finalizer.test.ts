import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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

vi.mock("#modules/git/worktree-lifecycle.js", () => ({
  inspectAutomationWorktree,
  listAutomationWorktreeUniqueCommits,
  reconcileAutomationWorktrees,
}));
vi.mock("./runtime-resource-ports.js", () => ({ releaseBuilderPortRange }));
vi.mock("#modules/autonomy/workflow-state-recovery-claims.js", () => ({
  findRecoveryClaim,
}));

import { finalizeBuilderTerminalWorktree } from "./terminal-worktree-finalizer.js";

const tempDirs: string[] = [];

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
  };
}

function continuedFinalizerInput(): WorkflowTerminalFinalizerInput {
  const input = finalizerInput("failed");
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
    });
  });

  it("requests one continuation for terminal preserved changes", async () => {
    mockPreservedWorktree({
      claimRunId: "builder-run",
      dirtyState: "dirty",
      blocker: "worktree has uncommitted tracked changes",
    });
    const input = finalizerInput("failed");

    await finalizeBuilderTerminalWorktree(input);

    expect(input.emit).toHaveBeenCalledWith(
      "autonomy.builder.recovery.requested",
      expect.objectContaining({
        taskId: "task-one",
        sourceRunId: "builder-run",
        worktreeRunId: "builder-run",
      }),
    );
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

  it("hands an exhausted continuation to bounded state recovery without dispatching again", async () => {
    mockPreservedWorktree({
      claimRunId: "recovery-run",
      dirtyState: "dirty",
      blocker: "worktree has uncommitted tracked changes",
    });
    const input = continuedFinalizerInput();
    input.metadata.steps.push({
      id: "build",
      type: "agent",
      status: "failed",
      startedAt: "2026-07-29T15:21:32.689Z",
      completedAt: "2026-07-30T00:46:46.634Z",
      durationMs: 33_913_945,
      activeDurationMs: 21_600_003,
      error: 'Step "build" timed out after 21600000ms of active runtime',
    });

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
      blockers: ["worktree has uncommitted tracked changes"],
      recoveryRequested: false,
      recoveryAction: {
        kind: "state-recovery-required",
        reason: "preserved builder continuation exhausted active runtime",
        inspectCommand: "pnpm kota workflow state-recovery list",
        resolveCommand:
          'pnpm kota workflow state-recovery resolve task-one --action <release|supersede> --reason "<reason>"',
      },
    });
  });
});
