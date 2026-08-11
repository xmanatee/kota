import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import {
  type ClaimAwareRepoTaskQueueSnapshot,
  getClaimAwareRepoTaskQueueSnapshot,
} from "#modules/autonomy/queue-availability.js";
import { onRecoveryTrigger } from "#modules/autonomy/recovery.js";
import { reconcileAutomationWorktrees } from "#modules/git/worktree-lifecycle.js";
import { runBuilderHarnessPreflight } from "./builder-harness-preflight.js";
import {
  BUILDER_RECOVERY_EVENT,
  type BuilderRecoveryDispatchResult,
  requestPendingBuilderRecoveries,
} from "./recovery-continuation.js";
import { workflowWorkspaceDir } from "./workspace.js";

type InspectResult = ClaimAwareRepoTaskQueueSnapshot & { dirty: boolean };
type ReconcileWorktreesResult = ReturnType<typeof reconcileAutomationWorktrees>;

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
  run: (ctx) => {
    const worktree = getRepoWorktreeStatus(workflowWorkspaceDir(ctx));
    const dirty = worktree.available && worktree.dirty;
    return { ...getClaimAwareRepoTaskQueueSnapshot(ctx.projectDir), dirty };
  },
});

export const reconcileWorktreesForRecoveryStep =
  typedCodeStep<ReconcileWorktreesResult>({
    id: "reconcile-worktrees-for-recovery",
    type: "code",
    when: onRecoveryTrigger,
    validate: (raw) =>
      expectStructuredOutput<ReconcileWorktreesResult>(raw, [
        "inspected",
        "active",
        "unlocked",
        "removed",
        "preserved",
        "items",
      ]),
    run: (ctx) => reconcileAutomationWorktrees(ctx.projectDir),
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
    run: requestPendingBuilderRecoveries,
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
