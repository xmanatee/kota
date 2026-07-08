import type {
  WorkflowStateRecoveryArtifact,
  WorkflowStateRecoveryClaim,
  WorkflowStateRecoveryProvider,
  WorkflowStateRecoveryResolveInput,
  WorkflowStateRecoveryResolveResult,
} from "#modules/workflow-ops/state-recovery-provider.js";
import { validateWorkflowStateRecoveryArtifactRunId } from "#modules/workflow-ops/state-recovery-provider.js";
import {
  readActiveTaskClaim,
  releaseTaskClaim,
  supersedeTaskClaim,
  type TaskClaimInspection,
  taskClaimPath,
} from "./task-claims.js";
import { finishResolve } from "./workflow-state-recovery-artifacts.js";
import {
  findPendingMergeClaim,
  listPendingMergeClaims,
  projectClaim,
} from "./workflow-state-recovery-claims.js";

function resolveMissingClaim(
  input: WorkflowStateRecoveryResolveInput,
): WorkflowStateRecoveryResolveResult {
  const message = input.runId
    ? `No pending-merge task claim found for ${input.taskId}/${input.runId}`
    : `No pending-merge task claim found for ${input.taskId}`;
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
    after: findPendingMergeClaim(input.projectDir, input.taskId),
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
): WorkflowStateRecoveryResolveResult {
  const claim = before.claim;
  const evidence = [
    `workflow state recovery ${input.action}`,
    `actor=${input.actor ?? "workflow-state-recovery"}`,
    `rationale=${input.rationale}`,
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

  const after = findPendingMergeClaim(input.projectDir, input.taskId);
  const resultLabel: WorkflowStateRecoveryArtifact["result"] =
    input.action === "release" ? "released" : "superseded";
  const message = `Task claim ${claim.taskId}/${claim.runId} ${resultLabel}.`;
  const written = finishResolve({
    resolveInput: input,
    before,
    after,
    result: resultLabel,
    message,
  });
  return {
    ok: true,
    action: input.action,
    message,
    ...written,
  };
}

function resolvePendingMergeClaim(
  input: WorkflowStateRecoveryResolveInput,
): WorkflowStateRecoveryResolveResult {
  const active = readActiveTaskClaim(input.projectDir, input.taskId);
  if (active !== null && active.status !== "pending-merge") {
    const inspection: TaskClaimInspection = {
      claim: active,
      path: taskClaimPath(input.projectDir, input.taskId),
      recoveryStatus: "agent-running",
      safeToRetry: false,
    };
    return refuseResolve(
      input,
      projectClaim(input.projectDir, inspection),
      `Active task claim ${input.taskId} is ${active.status}, not pending-merge`,
      "invalid_action",
    );
  }

  const before = findPendingMergeClaim(input.projectDir, input.taskId);
  if (!before) return resolveMissingClaim(input);
  if (input.runId !== undefined && before.claim.runId !== input.runId) {
    return resolveMissingClaim(input);
  }
  if (before.recommendedAction.kind !== input.action) {
    return refuseResolve(
      input,
      before,
      `Requested ${input.action}, but safe action is ${before.recommendedAction.kind}: ${before.recommendedAction.reason}`,
      "unsafe",
    );
  }
  return mutateClaim(input, before);
}

export function createWorkflowStateRecoveryProvider(): WorkflowStateRecoveryProvider {
  return {
    list(input) {
      return {
        ok: true,
        claims: listPendingMergeClaims(input.projectDir),
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
      return resolvePendingMergeClaim({
        ...input,
        ...(artifactRunId.artifactRunId !== undefined
          ? { artifactRunId: artifactRunId.artifactRunId }
          : {}),
      });
    },
  };
}
