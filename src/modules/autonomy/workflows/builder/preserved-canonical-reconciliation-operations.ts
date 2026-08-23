import { writeJsonFileAtomic } from "#core/util/json-file.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { updateTaskClaimCanonicalReconciliation } from "#modules/autonomy/task-claims.js";
import { updateAutomationWorktreeCanonicalReconciliation } from "#modules/git/worktree-canonical-reconciliation-metadata.js";
import type { AutomationWorktreeCanonicalReconciliation } from "#modules/git/worktree-lifecycle-types.js";

type PersistPreservedCanonicalReconciliationInput = {
  projectDir: string;
  taskId: string;
  worktreeRunId: string;
  recoveryRunId: string;
  workflowId: string;
  record: AutomationWorktreeCanonicalReconciliation;
};

export function persistPreservedCanonicalReconciliationInWorker(
  input: PersistPreservedCanonicalReconciliationInput,
): void {
  writeJsonFileAtomic(input.record.artifactPath, input.record);
  updateAutomationWorktreeCanonicalReconciliation(
    {
      projectDir: input.projectDir,
      taskId: input.taskId,
      runId: input.worktreeRunId,
    },
    input.record,
  );
  const claim = updateTaskClaimCanonicalReconciliation({
    projectDir: input.projectDir,
    taskId: input.taskId,
    runId: input.recoveryRunId,
    workflowId: input.workflowId,
    evidence:
      `preserved recovery ${input.record.phase}: ${input.record.reason ?? input.record.canonicalHeadCommit}`,
    canonicalReconciliation: input.record,
  });
  if (!claim.changed) {
    throw new Error(
      claim.reason ??
        `Could not persist canonical reconciliation on task claim ${input.taskId}`,
    );
  }
}

export const persistPreservedCanonicalReconciliationOperation =
  defineWorkflowBlockingOperation<
    PersistPreservedCanonicalReconciliationInput,
    void
  >(import.meta.url, "persistPreservedCanonicalReconciliationInWorker");
