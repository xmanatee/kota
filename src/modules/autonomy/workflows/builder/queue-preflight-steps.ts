import { repoWorktreeStatusOperation } from "#core/util/repo-worktree-operation.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import {
  type ClaimAwareRepoTaskQueueSnapshot,
  claimAwareRepoTaskQueueSnapshotOperation,
} from "#modules/autonomy/queue-availability.js";
import { onRecoveryTrigger } from "#modules/autonomy/recovery.js";
import {
  type ReconcileBuilderWorktreesResult,
  reconcileBuilderWorktreesOperation,
} from "./blocking-operations.js";
import { runBuilderHarnessPreflight } from "./builder-harness-preflight.js";
import {
  BUILDER_RECOVERY_EVENT,
  type BuilderRecoveryDispatchResult,
  emitBuilderRecoveryRequest,
  inspectPendingBuilderRecoveriesOperation,
} from "./recovery-continuation.js";
import { workflowWorkspaceDir } from "./workspace.js";

type InspectResult = ClaimAwareRepoTaskQueueSnapshot & { dirty: boolean };

export const inspectReadyQueue = typedCodeStep<InspectResult>({
  id: "inspect-ready-queue",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<InspectResult>(raw, [
      "dirty",
      "pullableCount",
      "actionableCount",
      "counts",
    ]),
  run: async (ctx) => {
    const workspaceDir = workflowWorkspaceDir(ctx);
    const [worktree, queue] = await Promise.all([
      ctx.runBlocking(repoWorktreeStatusOperation, { projectDir: workspaceDir }),
      ctx.runBlocking(claimAwareRepoTaskQueueSnapshotOperation, {
        projectDir: ctx.projectDir,
      }),
    ]);
    const dirty = worktree.available && worktree.dirty;
    return { ...queue, dirty };
  },
});

export const reconcileWorktreesForRecoveryStep =
  typedCodeStep<ReconcileBuilderWorktreesResult>({
    id: "reconcile-worktrees-for-recovery",
    type: "code",
    when: onRecoveryTrigger,
    validate: (raw) =>
      expectStructuredOutput<ReconcileBuilderWorktreesResult>(raw, [
        "inspected",
        "active",
        "unlocked",
        "removed",
        "preserved",
        "items",
      ]),
    run: ({ projectDir, runBlocking }) =>
      runBlocking(reconcileBuilderWorktreesOperation, { projectDir }),
  });

export const requestRecoveryContinuationsStep =
  typedCodeStep<BuilderRecoveryDispatchResult>({
    id: "request-recovery-continuations",
    type: "code",
    when: onRecoveryTrigger,
    validate: (raw) =>
      expectStructuredOutput<BuilderRecoveryDispatchResult>(raw, [
        "candidateCount",
        "requested",
      ]),
    run: async ({ projectDir, emit, runBlocking }) => {
      const result = await runBlocking(inspectPendingBuilderRecoveriesOperation, {
        projectDir,
      });
      for (const request of result.requested) {
        emitBuilderRecoveryRequest(emit, request);
      }
      return result;
    },
  });

export const builderHarnessPreflightStep = {
  id: "preflight-builder-harness",
  type: "code" as const,
  when: (ctx: WorkflowStepContext) => {
    if (ctx.trigger.event === "runtime.recovered") return false;
    if (ctx.trigger.event === BUILDER_RECOVERY_EVENT) return true;
    const { dirty, actionableCount } = inspectReadyQueue.outputRequired(ctx);
    return !dirty && actionableCount > 0;
  },
  run: (ctx: WorkflowStepContext) =>
    runBuilderHarnessPreflight({
      agentRuntime: ctx.agentRuntime,
      runDirPath: ctx.workflow.runDirPath,
    }),
};
