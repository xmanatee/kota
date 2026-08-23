import type { ModuleEventProxy } from "#core/modules/module-types.js";
import {
  type DisposedAutomationWorktreeResult,
  disposeAutomationWorktree,
  validateCanonicalSupersedingCommit,
} from "#modules/git/worktree-lifecycle.js";
import type {
  WorkflowStateRecoveryArtifact,
  WorkflowStateRecoveryClaim,
  WorkflowStateRecoveryProvider,
  WorkflowStateRecoveryResolveInput,
  WorkflowStateRecoveryResolveResult,
} from "#modules/workflow-ops/state-recovery-provider.js";
import { validateWorkflowStateRecoveryArtifactRunId } from "#modules/workflow-ops/state-recovery-provider.js";
import {
  releaseTaskClaim,
  supersedeTaskClaim,
} from "./task-claims.js";
import { finishResolve } from "./workflow-state-recovery-artifacts.js";
import {
  findRecoveryClaim,
  listRecoveryClaims,
  listRecoveryDeadLetters,
  listRecoveryWorktrees,
} from "./workflow-state-recovery-claims.js";
import { dismissWorkflowStateRecoveryDeadLetters } from "./workflow-state-recovery-dead-letters.js";
import { completeWorkflowStateRecoveryTask } from "./workflow-state-recovery-task.js";
import { hasPreservedWorktreeChanges } from "./workflow-state-recovery-worktree.js";

function resolveMissingClaim(
  input: WorkflowStateRecoveryResolveInput,
): WorkflowStateRecoveryResolveResult {
  const message = input.runId
    ? `No unresolved task claim found for ${input.taskId}/${input.runId}`
    : `No unresolved task claim found for ${input.taskId}`;
  const written = finishResolve({
    resolveInput: input,
    before: null,
    after: null,
    result: "noop",
    message,
  });
  return {
    ok: true,
    action: "noop",
    message,
    ...written,
  };
}

function refuseResolve(
  input: WorkflowStateRecoveryResolveInput,
  before: WorkflowStateRecoveryClaim,
  message: string,
  reason: "invalid_action" | "unsafe" | "write_conflict",
): WorkflowStateRecoveryResolveResult {
  const written = finishResolve({
    resolveInput: input,
    before,
    after: findRecoveryClaim(input.projectDir, input.taskId),
    result: "refused",
    message,
  });
  return {
    ok: false,
    reason,
    message,
    ...written,
  };
}

function mutateClaim(
  input: WorkflowStateRecoveryResolveInput,
  before: WorkflowStateRecoveryClaim,
  events?: ModuleEventProxy,
): WorkflowStateRecoveryResolveResult {
  const claim = before.claim;
  let worktreeCleanup: WorkflowStateRecoveryArtifact["worktreeCleanup"];
  if (input.cleanupWorktree === true) {
    const cleanup = disposeRecoveryWorktree(input, before);
    worktreeCleanup = {
      attempted: true,
      removed: cleanup.removed,
      message: cleanup.message,
      blockers: cleanup.blockers,
    };
    if (!cleanup.removed) {
      const written = finishResolve({
        resolveInput: input,
        before,
        after: findRecoveryClaim(input.projectDir, input.taskId),
        result: "refused",
        message: cleanup.message,
        worktreeCleanup,
      });
      return {
        ok: false,
        reason: "unsafe",
        message: cleanup.message,
        ...written,
      };
    }
  }
  const evidence = [
    `workflow state recovery ${input.action}`,
    `actor=${input.actor ?? "workflow-state-recovery"}`,
    `rationale=${input.rationale}`,
    ...(input.supersededByCommit !== undefined
      ? [`supersededBy=${input.supersededByCommit}`]
      : []),
  ].join("; ");
  const result =
    input.action === "release"
      ? releaseTaskClaim({
          projectDir: input.projectDir,
          taskId: claim.taskId,
          runId: claim.runId,
          workflowId: claim.workflowId,
          evidence,
        })
      : supersedeTaskClaim({
          projectDir: input.projectDir,
          taskId: claim.taskId,
          runId: claim.runId,
          workflowId: claim.workflowId,
          evidence,
        });

  if (!result.changed) {
    return refuseResolve(
      input,
      before,
      result.reason ?? "claim changed before recovery could mutate it",
      "write_conflict",
    );
  }

  const after = findRecoveryClaim(input.projectDir, input.taskId);
  const dismissedDeadLetterIds = input.dismissDeadLetters === true
    ? dismissWorkflowStateRecoveryDeadLetters(
        input.projectDir,
        before,
        input.rationale,
        events,
      )
    : [];
  const taskMove = input.completeTask === true
    ? completeWorkflowStateRecoveryTask(input.projectDir, claim.taskId)
    : undefined;
  const resultLabel: WorkflowStateRecoveryArtifact["result"] =
    input.action === "release" ? "released" : "superseded";
  const messageParts = [`Task claim ${claim.taskId}/${claim.runId} ${resultLabel}.`];
  if (worktreeCleanup?.removed) messageParts.push("Related worktree removed.");
  if (dismissedDeadLetterIds.length > 0) {
    messageParts.push(`Dismissed ${dismissedDeadLetterIds.length} related DLQ item(s).`);
  }
  if (taskMove?.moved) messageParts.push("Task moved to done/.");
  if (taskMove && !taskMove.moved) messageParts.push(`Task move skipped: ${taskMove.message}`);
  const message = messageParts.join(" ");
  const written = finishResolve({
    resolveInput: input,
    before,
    after,
    result: resultLabel,
    message,
    dismissedDeadLetterIds,
    ...(worktreeCleanup !== undefined ? { worktreeCleanup } : {}),
    ...(taskMove !== undefined ? { taskMove } : {}),
  });
  return {
    ok: true,
    action: input.action,
    message,
    ...written,
  };
}

function resolveRecoveryClaim(
  input: WorkflowStateRecoveryResolveInput,
  events?: ModuleEventProxy,
): WorkflowStateRecoveryResolveResult {
  const before = findRecoveryClaim(input.projectDir, input.taskId);
  if (!before) return resolveMissingClaim(input);
  if (input.runId !== undefined && before.claim.runId !== input.runId) {
    return resolveMissingClaim(input);
  }
  if (input.action === "supersede" && input.supersededByCommit !== undefined) {
    const blocker = validateCanonicalSupersedingCommit(
      input.projectDir,
      input.supersededByCommit,
    );
    if (blocker !== null) {
      return refuseResolve(input, before, blocker, "unsafe");
    }
  }
  if (!isAcceptedRecoveryAction(input, before)) {
    return refuseResolve(
      input,
      before,
      `Requested ${input.action}, but safe action is ${before.recommendedAction.kind}: ${before.recommendedAction.reason}`,
      "unsafe",
    );
  }
  return mutateClaim(input, before, events);
}

function isAcceptedRecoveryAction(
  input: WorkflowStateRecoveryResolveInput,
  before: WorkflowStateRecoveryClaim,
): boolean {
  if (before.recommendedAction.kind === input.action) return true;
  if (
    input.action === "release" &&
    input.completeTask === true &&
    before.recoveryStatus === "pending-decomposition" &&
    before.ownerRunStatus !== "running" &&
    (before.worktree.state === "merged" || before.worktree.state === "removed") &&
    !hasPreservedWorktreeChanges(before.worktree)
  ) {
    return true;
  }
  return (
    input.action === "supersede" &&
    input.supersededByCommit !== undefined &&
    before.recommendedAction.kind === "needs-review" &&
    (!hasPreservedWorktreeChanges(before.worktree) ||
      input.discardWorktreeChanges === true)
  );
}

function disposeRecoveryWorktree(
  input: WorkflowStateRecoveryResolveInput,
  before: WorkflowStateRecoveryClaim,
): DisposedAutomationWorktreeResult {
  return disposeAutomationWorktree({
    projectDir: input.projectDir,
    taskId: before.claim.taskId,
    runId: before.claim.worktreeRunId,
    reason: input.rationale,
    disposition: input.action === "release" ? "released" : "superseded",
    ...(input.supersededByCommit !== undefined
      ? { supersededByCommit: input.supersededByCommit }
      : {}),
    ...(input.discardWorktreeChanges !== undefined
      ? { discardWorktreeChanges: input.discardWorktreeChanges }
      : {}),
  });
}

export function createWorkflowStateRecoveryProvider(
  events?: ModuleEventProxy,
): WorkflowStateRecoveryProvider {
  return {
    list(input) {
      return {
        ok: true,
        claims: listRecoveryClaims(input.projectDir),
        worktrees: listRecoveryWorktrees(input.projectDir),
        deadLetters: listRecoveryDeadLetters(input.projectDir),
      };
    },
    resolve(input) {
      const artifactRunId = validateWorkflowStateRecoveryArtifactRunId(input.artifactRunId);
      if (!artifactRunId.ok) {
        return {
          ok: false,
          reason: "invalid_input",
          message: artifactRunId.message,
        };
      }
      return resolveRecoveryClaim(
        {
          ...input,
          ...(artifactRunId.artifactRunId !== undefined
            ? { artifactRunId: artifactRunId.artifactRunId }
            : {}),
        },
        events,
      );
    },
  };
}
