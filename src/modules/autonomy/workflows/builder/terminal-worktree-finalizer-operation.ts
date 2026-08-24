import { writeJsonFileAtomic } from "#core/util/json-file.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import type {
  WorkflowRepairContinuationDecisionKind,
  WorkflowRunMetadata,
} from "#core/workflow/run-types.js";
import type { WorkflowAgentBackoffKind } from "#core/workflow/trigger-types.js";
import { classifyBuilderFailureForDecomposition } from "#modules/autonomy/builder-failure-classification.js";
import {
  markTaskClaimPendingDecomposition,
  releaseTaskClaim,
} from "#modules/autonomy/task-claims.js";
import { findRecoveryClaim } from "#modules/autonomy/workflow-state-recovery-claims.js";
import {
  inspectAutomationWorktree,
  listAutomationWorktreeUniqueCommits,
  reconcileAutomationWorktrees,
} from "#modules/git/worktree-lifecycle.js";
import {
  BUILDER_RECOVERY_EVENT,
  type BuilderRecoveryRequest,
  builderRecoveryRequestForCandidate,
} from "./recovery-continuation.js";
import { releaseBuilderPortRange } from "./runtime-resource-ports.js";
import {
  type BuilderTerminalClaimDisposition,
  type BuilderTerminalRecoveryAction,
  builderStateRecoveryAction,
  builderTerminalRecoveryAction,
  continuationDecisionFromMetadata,
} from "./terminal-worktree-finalizer-decision.js";

export type BuilderTerminalWorktreeFinalizerArtifact = {
  attempted: boolean;
  reason: string;
  taskId: string | null;
  runId: string;
  removed: boolean;
  blockers: string[];
  uniqueCommits: string[];
  portLeaseReleased: boolean;
  portLeaseError: string | null;
  recoveryRequested: boolean;
  continuationDecision: WorkflowRepairContinuationDecisionKind | null;
  claimDisposition: BuilderTerminalClaimDisposition;
  recoveryAction: BuilderTerminalRecoveryAction;
  artifactPath: string;
};

export type BuilderTerminalWorktreeOperationInput = {
  projectDir: string;
  metadata: WorkflowRunMetadata;
  triggerEvent: string;
  agentFailureKind?: WorkflowAgentBackoffKind;
  workspace: {
    taskId: string;
    worktreeRunId: string;
  };
  artifactPath: string;
};

export type BuilderTerminalWorktreeOperationOutput = {
  recoveryRequest: BuilderRecoveryRequest | null;
  logMessages: string[];
};

function writeArtifact(
  artifact: BuilderTerminalWorktreeFinalizerArtifact,
): void {
  writeJsonFileAtomic(artifact.artifactPath, artifact);
}

export async function runBuilderTerminalWorktreeFinalizerInWorker(
  input: BuilderTerminalWorktreeOperationInput,
): Promise<BuilderTerminalWorktreeOperationOutput> {
  const selector = {
    projectDir: input.projectDir,
    taskId: input.workspace.taskId,
    runId: input.workspace.worktreeRunId,
  };
  try {
    const before = inspectAutomationWorktree(selector);
    const unique = listAutomationWorktreeUniqueCommits(
      input.projectDir,
      before.branch || before.headCommit,
    );
    const reconciliation = reconcileAutomationWorktrees(input.projectDir);
    const item = reconciliation.items.find(
      (candidate) =>
        candidate.taskId === input.workspace.taskId &&
        candidate.runId === selector.runId,
    );
    const removed = before.metadata.state === "removed" || item?.removed === true;
    const baseBlockers = item?.blockers ?? before.cleanup.blockers;
    const blockers =
      !removed && unique.error !== undefined
        ? [...baseBlockers, unique.error]
        : baseBlockers;
    let reason = removed
      ? "terminal builder worktree had no unresolved cleanup blockers"
      : "terminal builder worktree preserved for recovery review";
    const candidate = findRecoveryClaim(
      input.projectDir,
      input.workspace.taskId,
    );
    const continuationDecision = continuationDecisionFromMetadata(input.metadata);
    const retryContinuation =
      input.triggerEvent !== BUILDER_RECOVERY_EVENT ||
      input.agentFailureKind !== undefined;
    const automaticContinuationAllowed =
      continuationDecision === null && retryContinuation;
    const recoveryRequested =
      !removed &&
      (automaticContinuationAllowed || continuationDecision === "preserve-yield") &&
      candidate?.claim.runId === input.metadata.id &&
      candidate.recommendedAction.kind === "needs-review";
    let claimDisposition: BuilderTerminalClaimDisposition = "preserved";
    const decompositionFailure = classifyBuilderFailureForDecomposition(
      input.metadata,
    );
    if (!removed && decompositionFailure) {
      const claimResult = markTaskClaimPendingDecomposition({
        projectDir: input.projectDir,
        taskId: input.workspace.taskId,
        runId: input.metadata.id,
        workflowId: input.metadata.workflow,
        evidence: `terminal builder run ${input.metadata.id} ${decompositionFailure}; preserved work awaits decomposer disposition`,
      });
      claimDisposition = claimResult.changed
        ? "pending-decomposition"
        : claimResult.safeToRetry
          ? "already-absent"
          : "conflict";
      if (claimDisposition === "pending-decomposition") {
        reason =
          "terminal builder worktree was preserved and its task is awaiting decomposition";
      }
    } else if (removed) {
      const claimResult = (decompositionFailure
        ? markTaskClaimPendingDecomposition
        : releaseTaskClaim)({
        projectDir: input.projectDir,
        taskId: input.workspace.taskId,
        runId: input.metadata.id,
        workflowId: input.metadata.workflow,
        evidence: decompositionFailure
          ? `terminal builder run ${input.metadata.id} ${decompositionFailure}; awaiting decomposer disposition`
          : `terminal builder run ${input.metadata.id} left no preserved worktree`,
      });
      claimDisposition = claimResult.changed
        ? decompositionFailure
          ? "pending-decomposition"
          : "released"
        : claimResult.safeToRetry
          ? "already-absent"
          : "conflict";
      if (claimDisposition === "pending-decomposition") {
        reason =
          "terminal builder worktree was removed and its task is awaiting decomposition";
      }
    }

    let portLeaseReleased = false;
    let portLeaseError: string | null = null;
    const logMessages: string[] = [];
    const profileId = before.metadata.runtimeResources?.profileId;
    if (profileId !== undefined) {
      try {
        const portLease = await releaseBuilderPortRange({
          projectDir: input.projectDir,
          runId: input.metadata.id,
          profileId,
        });
        portLeaseReleased = portLease.released;
      } catch (error) {
        portLeaseError = error instanceof Error ? error.message : String(error);
        logMessages.push(
          `Builder terminal finalizer could not release its port lease: ${portLeaseError}`,
        );
      }
    }

    const recoveryRequest =
      recoveryRequested &&
      continuationDecision !== "preserve-yield" &&
      candidate
        ? builderRecoveryRequestForCandidate(input.projectDir, candidate)
        : null;
    writeArtifact({
      attempted: true,
      reason,
      taskId: input.workspace.taskId,
      runId: input.metadata.id,
      removed,
      blockers,
      uniqueCommits: unique.commits,
      portLeaseReleased,
      portLeaseError,
      recoveryRequested,
      continuationDecision,
      claimDisposition,
      recoveryAction: builderTerminalRecoveryAction({
        triggerEvent: input.triggerEvent,
        taskId: input.workspace.taskId,
        removed,
        recoveryRequested,
        claimDisposition,
        continuationDecision,
      }),
      artifactPath: input.artifactPath,
    });
    return { recoveryRequest, logMessages };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeArtifact({
      attempted: true,
      reason: message,
      taskId: input.workspace.taskId,
      runId: input.metadata.id,
      removed: false,
      blockers: [message],
      uniqueCommits: [],
      portLeaseReleased: false,
      portLeaseError: null,
      recoveryRequested: false,
      continuationDecision: continuationDecisionFromMetadata(input.metadata),
      claimDisposition: "preserved",
      recoveryAction: builderStateRecoveryAction(
        input.workspace.taskId,
        "builder terminal finalizer failed before it could reconcile preserved work",
      ),
      artifactPath: input.artifactPath,
    });
    return {
      recoveryRequest: null,
      logMessages: [
        `Builder terminal worktree finalizer preserved error artifact: ${message}`,
      ],
    };
  }
}

export const builderTerminalWorktreeFinalizerOperation =
  defineWorkflowBlockingOperation<
    BuilderTerminalWorktreeOperationInput,
    BuilderTerminalWorktreeOperationOutput
  >(import.meta.url, "runBuilderTerminalWorktreeFinalizerInWorker");
