import {
  defineWorkflowBlockingOperation,
  type WorkflowBlockingOperationContext,
  type WorkflowBlockingOperationRunner,
} from "#core/workflow/blocking-operation.js";
import { checkAutonomyChangeDecisionForRun } from "#modules/autonomy/autonomy-change-decision.js";
import type { CommitResult } from "#modules/autonomy/commit-result.js";
import { checkDocBloat } from "#modules/autonomy/doc-bloat-check.js";
import { checkRepoHygiene } from "#modules/autonomy/hygiene-check.js";
import { checkObservabilityObligationsForRun } from "#modules/autonomy/observability-obligation.js";
import { checkSourceFileSize } from "#modules/autonomy/source-size-check.js";
import { checkSevereSourceFileSizeForRun } from "#modules/autonomy/source-size-review-artifact.js";
import type { QueueTaskClaimResult } from "#modules/autonomy/task-claims.js";
import { reconcileAutomationWorktrees } from "#modules/git/worktree-lifecycle.js";
import {
  checkBuilderWorkflowChangesStageable,
  commitBuilderWorkflowChanges,
  projectAgentRunArtifactsForValidation,
} from "./agent-run-artifacts.js";
import {
  checkMobileTypecheck,
  checkModuleBoundary,
} from "./project-repair-checks.js";
import {
  checkSuccessCriteriaDeclared,
  checkSuccessCriteriaVerified,
} from "./success-criteria-repair-checks.js";
import {
  checkActionableTaskClaimed,
  checkActionableTaskResolved,
  checkClaimedTaskCommitSet,
  checkClaimedTaskStateStaged,
} from "./task-state-repair-checks.js";

type BuilderCommitOperationInput = {
  workspaceDir: string;
  agentRunDir: string;
};

type BuilderAgentRunArtifactsOperationInput = BuilderCommitOperationInput;

export type ReconcileBuilderWorktreesResult = ReturnType<
  typeof reconcileAutomationWorktrees
>;

export type BuilderRepairCheckOperationInput =
  | {
      kind: "actionable-task-claimed";
      projectDir: string;
      claimProjectDir: string;
    }
  | {
      kind: "actionable-task-resolved";
      projectDir: string;
    }
  | {
      kind: "autonomy-change-decision";
      projectDir: string;
      runDirPath: string;
    }
  | {
      kind: "claimed-task-commit-set";
      projectDir: string;
      claim?: QueueTaskClaimResult;
    }
  | {
      kind: "claimed-task-state-staged";
      projectDir: string;
      claim?: QueueTaskClaimResult;
    }
  | {
      kind: "doc-bloat";
      projectDir: string;
    }
  | {
      kind: "module-boundary";
      projectDir: string;
    }
  | {
      kind: "observability-obligation";
      projectDir: string;
      runDirPath: string;
    }
  | {
      kind: "repo-hygiene";
      projectDir: string;
    }
  | {
      kind: "source-file-size-severe";
      projectDir: string;
      runDirPath: string;
    }
  | {
      kind: "source-file-size";
      projectDir: string;
    }
  | {
      kind: "success-criteria-declared";
      projectDir: string;
      runDirPath: string;
    }
  | {
      kind: "success-criteria-verified";
      runDirPath: string;
    };

export type BuilderRepairCheckOperationResult =
  | { status: "passed"; output: string }
  | { status: "failed"; output: string };

function captureRepairCheck(check: () => string): BuilderRepairCheckOperationResult {
  try {
    return { status: "passed", output: check() };
  } catch (error) {
    return {
      status: "failed",
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

export function runBuilderRepairCheckInWorker(
  input: BuilderRepairCheckOperationInput,
): BuilderRepairCheckOperationResult {
  if (input.kind === "actionable-task-claimed") {
    return captureRepairCheck(() =>
      checkActionableTaskClaimed(input.projectDir, input.claimProjectDir)
    );
  }
  if (input.kind === "actionable-task-resolved") {
    return captureRepairCheck(() => checkActionableTaskResolved(input.projectDir));
  }
  if (input.kind === "autonomy-change-decision") {
    return captureRepairCheck(() =>
      checkAutonomyChangeDecisionForRun(input.projectDir, input.runDirPath)
    );
  }
  if (input.kind === "doc-bloat") {
    return captureRepairCheck(() => checkDocBloat(input.projectDir));
  }
  if (input.kind === "claimed-task-commit-set") {
    return captureRepairCheck(() =>
      checkClaimedTaskCommitSet(input.projectDir, input.claim)
    );
  }
  if (input.kind === "claimed-task-state-staged") {
    return captureRepairCheck(() =>
      checkClaimedTaskStateStaged(input.projectDir, input.claim)
    );
  }
  if (input.kind === "module-boundary") {
    return captureRepairCheck(() => checkModuleBoundary(input.projectDir));
  }
  if (input.kind === "observability-obligation") {
    return captureRepairCheck(() =>
      checkObservabilityObligationsForRun(input.projectDir, input.runDirPath)
    );
  }
  if (input.kind === "repo-hygiene") {
    return captureRepairCheck(() => checkRepoHygiene(input.projectDir));
  }
  if (input.kind === "source-file-size-severe") {
    return captureRepairCheck(() =>
      checkSevereSourceFileSizeForRun(input.projectDir, input.runDirPath)
    );
  }
  if (input.kind === "source-file-size") {
    return captureRepairCheck(() => checkSourceFileSize(input.projectDir));
  }
  if (input.kind === "success-criteria-declared") {
    return captureRepairCheck(() =>
      checkSuccessCriteriaDeclared(input.runDirPath, input.projectDir)
    );
  }
  if (input.kind === "success-criteria-verified") {
    return captureRepairCheck(() =>
      checkSuccessCriteriaVerified(input.runDirPath)
    );
  }
  throw new Error(`Unsupported builder repair check input: ${input satisfies never}`);
}

export function checkBuilderCommitInWorker(
  input: BuilderCommitOperationInput,
): string {
  return checkBuilderWorkflowChangesStageable(
    input.workspaceDir,
    input.agentRunDir,
  );
}

export function projectBuilderAgentRunArtifactsInWorker(
  input: BuilderAgentRunArtifactsOperationInput,
): string {
  return projectAgentRunArtifactsForValidation(
    input.agentRunDir,
    input.workspaceDir,
  );
}

export function checkBuilderMobileTypecheckInWorker(
  input: { projectDir: string },
  context: WorkflowBlockingOperationContext,
): Promise<string> {
  return checkMobileTypecheck(input.projectDir, { signal: context.signal });
}

export function commitBuilderChangesInWorker(
  input: BuilderCommitOperationInput,
): CommitResult {
  return commitBuilderWorkflowChanges(input.workspaceDir, input.agentRunDir);
}

export function reconcileBuilderWorktreesInWorker(
  input: { projectDir: string },
): ReconcileBuilderWorktreesResult {
  return reconcileAutomationWorktrees(input.projectDir);
}

export const checkBuilderCommitOperation = defineWorkflowBlockingOperation<
  BuilderCommitOperationInput,
  string
>(import.meta.url, "checkBuilderCommitInWorker");

export const projectBuilderAgentRunArtifactsOperation =
  defineWorkflowBlockingOperation<
    BuilderAgentRunArtifactsOperationInput,
    string
  >(import.meta.url, "projectBuilderAgentRunArtifactsInWorker");

export const builderMobileTypecheckOperation = defineWorkflowBlockingOperation<
  { projectDir: string },
  string
>(import.meta.url, "checkBuilderMobileTypecheckInWorker");

export const commitBuilderChangesOperation = defineWorkflowBlockingOperation<
  BuilderCommitOperationInput,
  CommitResult
>(import.meta.url, "commitBuilderChangesInWorker");

export const builderRepairCheckOperation = defineWorkflowBlockingOperation<
  BuilderRepairCheckOperationInput,
  BuilderRepairCheckOperationResult
>(import.meta.url, "runBuilderRepairCheckInWorker");

export const reconcileBuilderWorktreesOperation =
  defineWorkflowBlockingOperation<
    { projectDir: string },
    ReconcileBuilderWorktreesResult
  >(import.meta.url, "reconcileBuilderWorktreesInWorker");

export async function runBuilderRepairCheck(
  runner: WorkflowBlockingOperationRunner,
  input: BuilderRepairCheckOperationInput,
): Promise<string> {
  const result = await runner.runBlocking(builderRepairCheckOperation, input);
  if (result.status === "failed") throw new Error(result.output);
  return result.output;
}
