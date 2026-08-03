import { join } from "node:path";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import type { WorkflowTerminalFinalizerInput } from "#core/workflow/types.js";
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
  builderRecoveryRequestForCandidate,
  emitBuilderRecoveryRequest,
} from "./recovery-continuation.js";
import { releaseBuilderPortRange } from "./runtime-resource-ports.js";

type BuilderTerminalWorktreeFinalizerArtifact = {
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
  claimDisposition: BuilderTerminalClaimDisposition;
  recoveryAction: BuilderTerminalRecoveryAction;
  artifactPath: string;
};

type BuilderTerminalClaimDisposition =
  | "preserved"
  | "pending-decomposition"
  | "released"
  | "already-absent"
  | "conflict";

type BuilderTerminalRecoveryAction =
  | {
      kind: "none";
      reason: string;
    }
  | {
      kind: "continuation-requested";
      reason: string;
    }
  | {
      kind: "decomposition-pending";
      reason: string;
    }
  | {
      kind: "state-recovery-required";
      reason: string;
      inspectCommand: string;
      resolveCommand: string;
    };

type BuilderTerminalWorkspace = {
  taskId: string;
  worktreeRunId: string;
};

function workspaceOutput(
  input: WorkflowTerminalFinalizerInput,
): BuilderTerminalWorkspace | null {
  const step = input.metadata.steps.find((candidate) => candidate.id === "prepare-worktree");
  const output = step?.output;
  if (output && typeof output === "object") {
    const candidate = output as {
      enabled?: boolean;
      taskId?: string;
      worktreeRunId?: string;
    };
    if (candidate.enabled === true && typeof candidate.taskId === "string") {
      return {
        taskId: candidate.taskId,
        worktreeRunId: candidate.worktreeRunId ?? input.metadata.id,
      };
    }
    if (candidate.enabled === false) return null;
  }
  const claimOutput = input.metadata.steps.find(
    (candidate) => candidate.id === "claim-task",
  )?.output;
  if (!claimOutput || typeof claimOutput !== "object") return null;
  const claim = claimOutput as {
    claimed?: boolean;
    taskId?: string;
    claim?: { worktreeRunId?: string } | null;
  };
  if (claim.claimed !== true || typeof claim.taskId !== "string") return null;
  return {
    taskId: claim.taskId,
    worktreeRunId: claim.claim?.worktreeRunId ?? input.metadata.id,
  };
}

function writeArtifact(
  artifact: BuilderTerminalWorktreeFinalizerArtifact,
): void {
  writeJsonFileAtomic(artifact.artifactPath, artifact);
}

function stateRecoveryAction(
  taskId: string,
  reason: string,
): BuilderTerminalRecoveryAction {
  return {
    kind: "state-recovery-required",
    reason,
    inspectCommand: "pnpm kota workflow state-recovery list",
    resolveCommand:
      `pnpm kota workflow state-recovery resolve ${taskId} ` +
      '--action <release|supersede> --reason "<reason>"',
  };
}

function recoveryActionFor(
  input: WorkflowTerminalFinalizerInput,
  taskId: string,
  removed: boolean,
  recoveryRequested: boolean,
  claimDisposition: BuilderTerminalClaimDisposition,
): BuilderTerminalRecoveryAction {
  if (claimDisposition === "conflict") {
    return stateRecoveryAction(
      taskId,
      "terminal builder worktree was removed but its task claim changed ownership",
    );
  }
  if (claimDisposition === "pending-decomposition") {
    return {
      kind: "decomposition-pending",
      reason: "exhausted builder task is reserved until decomposer dispositions it",
    };
  }
  if (removed) {
    return { kind: "none", reason: "terminal builder worktree was removed" };
  }
  if (recoveryRequested) {
    return {
      kind: "continuation-requested",
      reason: "one automatic preserved-work continuation was requested",
    };
  }
  if (input.trigger.event !== BUILDER_RECOVERY_EVENT) {
    return {
      kind: "none",
      reason: "terminal builder worktree awaits the normal recovery scan",
    };
  }
  return stateRecoveryAction(
    taskId,
    "preserved builder continuation needs recovery review",
  );
}

export async function finalizeBuilderTerminalWorktree(
  input: WorkflowTerminalFinalizerInput,
): Promise<void> {
  const workspace = workspaceOutput(input);
  if (!workspace) return;
  const runDirPath = join(input.projectDir, input.metadata.runDir);
  const artifactPath = join(runDirPath, "terminal-worktree-finalizer.json");

  const selector = {
    projectDir: input.projectDir,
    taskId: workspace.taskId,
    runId: workspace.worktreeRunId,
  };
  try {
    const before = inspectAutomationWorktree(selector);
    const unique = listAutomationWorktreeUniqueCommits(
      input.projectDir,
      before.branch || before.headCommit,
    );
    const reconciliation = reconcileAutomationWorktrees(input.projectDir);
    const item = reconciliation.items.find(
      (candidate) => candidate.taskId === workspace.taskId && candidate.runId === selector.runId,
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
    const candidate = findRecoveryClaim(input.projectDir, workspace.taskId);
    const retryContinuation =
      input.trigger.event !== BUILDER_RECOVERY_EVENT ||
      input.agentFailureKind !== undefined;
    const recoveryRequested =
      !removed &&
      retryContinuation &&
      candidate?.claim.runId === input.metadata.id &&
      candidate.recommendedAction.kind === "needs-review";
    let claimDisposition: BuilderTerminalClaimDisposition = "preserved";
    if (removed) {
      const decompositionFailure = classifyBuilderFailureForDecomposition(input.metadata);
      const claimResult = (decompositionFailure
        ? markTaskClaimPendingDecomposition
        : releaseTaskClaim)({
        projectDir: input.projectDir,
        taskId: workspace.taskId,
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
        reason = "terminal builder worktree was removed and its task is awaiting decomposition";
      }
    }
    let portLeaseReleased = false;
    let portLeaseError: string | null = null;
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
        input.log(`Builder terminal finalizer could not release its port lease: ${portLeaseError}`);
      }
    }
    writeArtifact({
      attempted: true,
      reason,
      taskId: workspace.taskId,
      runId: input.metadata.id,
      removed,
      blockers,
      uniqueCommits: unique.commits,
      portLeaseReleased,
      portLeaseError,
      recoveryRequested,
      claimDisposition,
      recoveryAction: recoveryActionFor(
        input,
        workspace.taskId,
        removed,
        recoveryRequested,
        claimDisposition,
      ),
      artifactPath,
    });
    if (recoveryRequested && candidate) {
      emitBuilderRecoveryRequest(
        input.emit,
        builderRecoveryRequestForCandidate(candidate),
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.log(`Builder terminal worktree finalizer preserved error artifact: ${message}`);
    writeArtifact({
      attempted: true,
      reason: message,
      taskId: workspace.taskId,
      runId: input.metadata.id,
      removed: false,
      blockers: [message],
      uniqueCommits: [],
      portLeaseReleased: false,
      portLeaseError: null,
      recoveryRequested: false,
      claimDisposition: "preserved",
      recoveryAction: stateRecoveryAction(
        workspace.taskId,
        "builder terminal finalizer failed before it could reconcile preserved work",
      ),
      artifactPath,
    });
  }
}
