import {
  runWorkflowBlockingOperation,
  type WorkflowBlockingOperationRunner,
} from "#core/workflow/blocking-operation.js";
import {
  acquireMergeGateLock,
  releaseMergeGateLock,
} from "./worktree-merge-gate-lock.js";
import type {
  MergeGatePhaseInput,
  MergeGatePhaseResult,
  MergeGateResolutionState,
} from "./worktree-merge-gate-operation-types.js";
import {
  writeMergeGateMetricsOperation,
} from "./worktree-merge-gate-operations.js";
import { prepareMergeAutomationWorktreeOperation } from "./worktree-merge-gate-prepare-operation.js";
import { continueMergeAutomationWorktreeOperation } from "./worktree-merge-gate-resolution-operation.js";
import {
  DEFAULT_MAX_RESOLUTION_ATTEMPTS,
} from "./worktree-merge-gate-support.js";
import type {
  MergeAutomationWorktreeInput,
  MergeGateResolverResult,
  MergeGateResult,
} from "./worktree-merge-gate-types.js";

export type {
  MergeAutomationWorktreeInput,
  MergeConflictKind,
  MergeGateConflict,
  MergeGateResolver,
  MergeGateResolverRequest,
  MergeGateResolverResult,
  MergeGateResult,
  MergeGateStatus,
  MergeGateValidation,
} from "./worktree-merge-gate-types.js";

type MergeGatePhaseRunner = {
  prepare: (input: MergeGatePhaseInput) => Promise<MergeGatePhaseResult>;
  continueResolution: (input: {
    state: MergeGateResolutionState;
    resolution: MergeGateResolverResult;
  }) => Promise<MergeGatePhaseResult>;
  writeMetrics: (input: {
    result: MergeGateResult;
    waitMs: number;
    mergeDurationMs: number;
  }) => Promise<MergeGateResult>;
};

const defaultBlockingOperationRunner: WorkflowBlockingOperationRunner = {
  runBlocking: (operation, input) =>
    runWorkflowBlockingOperation(operation, input),
};

function workerPhaseRunner(
  runner: WorkflowBlockingOperationRunner,
): MergeGatePhaseRunner {
  return {
    prepare: (input) =>
      runner.runBlocking(prepareMergeAutomationWorktreeOperation, input),
    continueResolution: (input) =>
      runner.runBlocking(continueMergeAutomationWorktreeOperation, input),
    writeMetrics: (input) =>
      runner.runBlocking(writeMergeGateMetricsOperation, input),
  };
}

async function coordinateMergeAutomationWorktree(
  input: MergeAutomationWorktreeInput,
  runner: MergeGatePhaseRunner,
): Promise<MergeGateResult> {
  const selector = {
    projectDir: input.projectDir,
    taskId: input.taskId,
    runId: input.runId,
  };
  const lock = await acquireMergeGateLock({
    ...selector,
    signal: input.signal,
  });

  const mergeStartedAt = Date.now();
  try {
    let phase = await runner.prepare({
      ...selector,
      validationCommand: input.validationCommand,
      resolverConfigured: input.resolver !== undefined,
      maxResolutionAttempts:
        input.maxResolutionAttempts ?? DEFAULT_MAX_RESOLUTION_ATTEMPTS,
    });
    while (phase.kind === "resolve") {
      if (!input.resolver) {
        throw new Error(
          "Merge gate requested conflict resolution without a configured resolver",
        );
      }
      const state = phase.state;
      const resolution = await input.resolver(phase.request);
      phase = await runner.continueResolution({ state, resolution });
    }
    return runner.writeMetrics({
      result: phase.result,
      waitMs: lock.waitMs,
      mergeDurationMs: Date.now() - mergeStartedAt,
    });
  } finally {
    await releaseMergeGateLock(input.projectDir, lock.ownerId);
  }
}

export function mergeAutomationWorktree(
  input: MergeAutomationWorktreeInput,
  runner: WorkflowBlockingOperationRunner = defaultBlockingOperationRunner,
): Promise<MergeGateResult> {
  return coordinateMergeAutomationWorktree(input, workerPhaseRunner(runner));
}
