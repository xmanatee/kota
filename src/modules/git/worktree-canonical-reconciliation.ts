import {
  runWorkflowBlockingOperation,
  type WorkflowBlockingOperationRunner,
} from "#core/workflow/blocking-operation.js";
import type { CanonicalReconciliationOperationInput } from "./worktree-canonical-reconciliation-operation-types.js";
import {
  blockCanonicalResolutionOperation,
  blockedCanonicalReconciliationOperation,
  continueCanonicalReconciliationOperation,
  prepareCanonicalReconciliationOperation,
} from "./worktree-canonical-reconciliation-operations.js";
import type { CheckpointAndReconcileAutomationWorktreeInput } from "./worktree-canonical-reconciliation-support.js";
import type { AutomationWorktreeCanonicalReconciliation } from "./worktree-lifecycle-types.js";
import {
  acquireMergeGateLock,
  releaseMergeGateLock,
} from "./worktree-merge-gate-lock.js";

export type { CheckpointAndReconcileAutomationWorktreeInput } from "./worktree-canonical-reconciliation-support.js";

const DEFAULT_RESOLUTION_ATTEMPTS = 2;

async function persistProgress(
  input: CheckpointAndReconcileAutomationWorktreeInput,
  records: AutomationWorktreeCanonicalReconciliation[],
): Promise<void> {
  for (const record of records) await input.onProgress(record);
}

export async function checkpointAndReconcileAutomationWorktree(
  input: CheckpointAndReconcileAutomationWorktreeInput,
  runner: WorkflowBlockingOperationRunner = {
    runBlocking: runWorkflowBlockingOperation,
  },
): Promise<AutomationWorktreeCanonicalReconciliation> {
  const operation: CanonicalReconciliationOperationInput = {
    projectDir: input.projectDir,
    taskId: input.taskId,
    runId: input.runId,
    recoveryRunId: input.recoveryRunId,
    artifactPath: input.artifactPath,
    validationCommands: input.validationCommands,
    maxResolutionAttempts:
      input.maxResolutionAttempts ?? DEFAULT_RESOLUTION_ATTEMPTS,
  };
  const lock = await acquireMergeGateLock({
    projectDir: input.projectDir,
    taskId: input.taskId,
    runId: input.runId,
    timeoutMs: input.lockTimeoutMs,
  });
  if (!lock.acquired) {
    const blocked = await runner.runBlocking(
      blockedCanonicalReconciliationOperation,
      { operation, reason: lock.reason },
    );
    await input.onProgress(blocked);
    return blocked;
  }

  try {
    let phase = await runner.runBlocking(
      prepareCanonicalReconciliationOperation,
      operation,
    );
    await persistProgress(input, phase.progress);
    while (phase.kind === "resolve") {
      if (!input.resolver || operation.maxResolutionAttempts <= 0) {
        phase = await runner.runBlocking(
          blockCanonicalResolutionOperation,
          {
            state: phase.state,
            reason: "text conflicts require the configured bounded merge resolver",
          },
        );
      } else {
        const resolution = await input.resolver(phase.request);
        phase = await runner.runBlocking(
          continueCanonicalReconciliationOperation,
          { state: phase.state, resolution },
        );
      }
      await persistProgress(input, phase.progress);
    }
    return phase.record;
  } finally {
    await releaseMergeGateLock(input.projectDir);
  }
}
