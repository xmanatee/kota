import type { AgentDef } from "#core/agents/agent-types.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  type EvaluatorCalibrationArtifact,
  writeCalibrationArtifact,
} from "#modules/autonomy/evaluator-calibration.js";
import {
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_BUILDER_AGENT_IDLE_TIMEOUT_MS,
  stepCommitRequiresDaemonRestart,
  stepCommitted,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import { commitBuilderWorkflowChanges } from "./agent-run-artifacts.js";
import type { BranchStepResult, CleanupResult } from "./branch-per-task.js";
import { cleanupMergedBranches, createPullRequest, createTaskBranch } from "./branch-per-task.js";
import { builderMaxConcurrentRunsFromConfig } from "./builder-config.js";
import {
  CLAIMED_TASK_CONSISTENCY_STEP_ID,
  type ClaimedTaskConsistencyResult,
  claimedTaskConsistencySucceeded,
  createClaimedTaskConsistencyStep,
} from "./claimed-task-consistency-step.js";
import {
  createCleanupAutomationWorktreeStep,
  createMergeGateStep,
  mergeGateSucceeded,
} from "./merge-gate-step.js";
import { createBuilderParallelMetricsStep } from "./parallel-metrics-step.js";
import {
  type BuilderWorkspaceResult,
  createPrepareBuilderWorktreeStep,
} from "./prepare-worktree-step.js";
import {
  createPreservedCanonicalReconciliationStep,
  preservedCanonicalReconciliationReady,
} from "./preserved-canonical-reconciliation-step.js";
import {
  builderHarnessPreflightStep,
  inspectReadyQueue,
  reconcileWorktreesForRecoveryStep,
  requestRecoveryContinuationsStep,
} from "./queue-preflight-steps.js";
import { BUILDER_RECOVERY_EVENT } from "./recovery-continuation.js";
import { builderRepairChecks } from "./repair-checks.js";
import type { BuilderRunSummary } from "./run-summary.js";
import { writeBuilderRunSummary } from "./run-summary.js";
import { createCleanupBuilderRuntimeResourcesStep } from "./runtime-resource-cleanup-step.js";
import {
  createClaimTaskStep,
  createMarkClaimPendingMergeStep,
  createReleaseTaskClaimStep,
} from "./task-claim-step.js";
import { finalizeBuilderTerminalWorktree } from "./terminal-worktree-finalizer.js";
import { builderAgentRunDir, workflowWorkspaceDir } from "./workspace.js";

export const agent: AgentDef = {
  name: "builder",
  role: "Ship one cohesive improvement per run by resuming, pulling, or promoting one normalized task.",
  promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  skills: "all",
  // Builder ships arbitrary code changes — its scope is explicitly
  // unrestricted rather than absence-means-unlimited.
  writeScope: [],
};

const claimTaskStep = createClaimTaskStep(inspectReadyQueue);
const prepareWorktreeStep = createPrepareBuilderWorktreeStep(claimTaskStep);
const preservedCanonicalReconciliationStep =
  createPreservedCanonicalReconciliationStep();
const claimedTaskConsistencyStep = createClaimedTaskConsistencyStep(claimTaskStep);
const mergeGateStep = createMergeGateStep();
const cleanupAutomationWorktreeStep = createCleanupAutomationWorktreeStep();
const cleanupBuilderRuntimeResourcesStep = createCleanupBuilderRuntimeResourcesStep();
const builderParallelMetricsStep = createBuilderParallelMetricsStep();

function builderCommitPublished(ctx: WorkflowStepContext): boolean {
  if (!stepCommitted("commit")(ctx)) return false;
  const workspace = ctx.stepOutputs["prepare-worktree"] as BuilderWorkspaceResult | undefined;
  return workspace?.enabled !== true || mergeGateSucceeded(ctx);
}

const builderWorkflow: WorkflowDefinitionInput = {
  name: "builder",
  description: "Build KOTA by shipping one cohesive improvement per workflow run.",
  tags: ["monitored"],
  recoveryCapable: true,
  defaultAutonomyMode: "autonomous",
  terminalFinalizer: finalizeBuilderTerminalWorktree,
  maxConcurrentRuns: ({ config }) =>
    builderMaxConcurrentRunsFromConfig(config),
  dispatchBurst: ({ config, trigger }) => {
    const maxRuns = builderMaxConcurrentRunsFromConfig(config);
    const actionableCount = trigger.payload?.actionableCount;
    if (typeof actionableCount !== "number") return 1;
    if (!Number.isFinite(actionableCount) || actionableCount < 1) return 1;
    return Math.min(maxRuns, Math.floor(actionableCount));
  },
  triggers: [
    {
      event: "autonomy.queue.available",
    },
    {
      event: BUILDER_RECOVERY_EVENT,
    },
    // Recovery re-entry after a daemon crash: reset step stashes any dirt and
    // restores the base branch if the crash left the repo on a kota/task/*
    // branch. The agent build step is gated so it will not re-enter inside an
    // abandoned run.
    {
      event: "runtime.recovered",
    },
  ],
  steps: [
    {
      id: "reset-for-recovery",
      type: "code",
      when: onRecoveryTrigger,
      run: (ctx) =>
        resetWorktreeForRecovery({
          projectDir: workflowWorkspaceDir(ctx),
          workflowName: "builder",
          restoreBaseBranch: true,
        }),
    },
    reconcileWorktreesForRecoveryStep,
    requestRecoveryContinuationsStep,
    inspectReadyQueue,
    builderHarnessPreflightStep,
    claimTaskStep,
    prepareWorktreeStep,
    preservedCanonicalReconciliationStep,
    {
      id: "build",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: AUTONOMY_AGENT_DEFAULTS.effort,
      timeoutMs: null,
      idleTimeoutMs: AUTONOMY_BUILDER_AGENT_IDLE_TIMEOUT_MS,
      when: (ctx) => {
        if (ctx.trigger.event === "runtime.recovered") return false;
        // Builder runs only on actionable (ready + doing) work. A backlog-only
        // queue is shaped by `backlog-promoter` first so the build agent never
        // silently consumes reserve work.
        const { dirty, actionableCount } = inspectReadyQueue.outputRequired(ctx);
        const claim = claimTaskStep.output(ctx);
        const workspace = prepareWorktreeStep.output(ctx);
        if (ctx.trigger.event === BUILDER_RECOVERY_EVENT) {
          return (
            claim?.claimed === true &&
            workspace !== undefined &&
            preservedCanonicalReconciliationReady(ctx)
          );
        }
        return !dirty && actionableCount > 0 && claim?.claimed === true && workspace !== undefined;
      },
      repairLoop: {
        checks: builderRepairChecks(),
      },
    },
    typedCodeStep<BranchStepResult>({
      id: "create-task-branch",
      type: "code",
      when: stepSucceeded("build"),
      validate: (raw) =>
        expectStructuredOutput<BranchStepResult>(raw, [
          "branchPerTask",
          "branch",
          "baseBranch",
          "taskId",
        ]),
      run: (ctx) => createTaskBranch(ctx),
    }),
    claimedTaskConsistencyStep,
    {
      id: "commit",
      type: "code",
      when: (ctx) =>
        stepSucceeded("create-task-branch")(ctx) && claimedTaskConsistencySucceeded(ctx),
      run: (ctx) =>
        commitBuilderWorkflowChanges(workflowWorkspaceDir(ctx), builderAgentRunDir(ctx)),
    },
    typedCodeStep<BuilderRunSummary>({
      id: "write-run-summary",
      type: "code",
      when: stepCommitted("commit"),
      validate: (raw) =>
        expectStructuredOutput<BuilderRunSummary>(raw, [
          "runId",
          "workflow",
          "outcome",
          "taskId",
          "commitSha",
          "commitMessage",
          "filesChanged",
        ]),
      run: (ctx) => writeBuilderRunSummary(ctx),
    }),
    mergeGateStep,
    createReleaseTaskClaimStep(claimTaskStep),
    typedCodeStep<EvaluatorCalibrationArtifact>({
      id: "write-calibration-artifact",
      type: "code",
      when: (ctx) => claimedTaskConsistencySucceeded(ctx) && stepCommitted("commit")(ctx),
      validate: (raw) =>
        expectStructuredOutput<EvaluatorCalibrationArtifact>(raw, [
          "runId",
          "workflow",
          "verdict",
        ]),
      run: (ctx) =>
        writeCalibrationArtifact(ctx, {
          criticVerdictRunDir: builderAgentRunDir(ctx),
        }),
    }),
    cleanupAutomationWorktreeStep,
    {
      id: "create-pr",
      type: "code",
      when: (ctx) => {
        if (!claimedTaskConsistencySucceeded(ctx)) return false;
        if (!stepCommitted("commit")(ctx)) return false;
        const branchInfo = ctx.stepOutputs["create-task-branch"] as BranchStepResult | undefined;
        const workspaceInfo = ctx.stepOutputs["prepare-worktree"] as BuilderWorkspaceResult | undefined;
        if (workspaceInfo?.enabled === true) return false;
        return branchInfo?.branchPerTask === true;
      },
      run: (ctx) => createPullRequest(ctx),
    },
    createMarkClaimPendingMergeStep(claimTaskStep),
    cleanupBuilderRuntimeResourcesStep,
    typedCodeStep<CleanupResult>({
      id: "cleanup-merged-branches",
      type: "code",
      when: (ctx) => {
        const branchInfo = ctx.stepOutputs["create-task-branch"] as BranchStepResult | undefined;
        const workspaceInfo = ctx.stepOutputs["prepare-worktree"] as BuilderWorkspaceResult | undefined;
        return branchInfo?.branchPerTask === true && workspaceInfo?.enabled !== true;
      },
      validate: (raw) =>
        expectStructuredOutput<CleanupResult>(raw, ["cleaned", "warnings"]),
      run: (ctx) => cleanupMergedBranches(ctx),
    }),
    builderParallelMetricsStep,
    {
      id: "request-restart",
      type: "restart",
      when: (ctx) =>
        claimedTaskConsistencySucceeded(ctx) &&
        builderCommitPublished(ctx) &&
        stepCommitRequiresDaemonRestart("commit")(ctx),
      reason: "builder workflow published a validated commit",
      requires: ["commit", CLAIMED_TASK_CONSISTENCY_STEP_ID],
      allowPostRestartEmits: true,
    },
    {
      id: "emit-build-committed",
      type: "emit",
      when: (ctx) =>
        claimedTaskConsistencySucceeded(ctx) &&
        builderCommitPublished(ctx) &&
        stepSucceeded("write-run-summary")(ctx),
      event: "workflow.build.committed",
      payload: (ctx) => {
        const summary = ctx.stepOutputs["write-run-summary"] as BuilderRunSummary | undefined;
        const consistency = ctx.stepOutputs[
          CLAIMED_TASK_CONSISTENCY_STEP_ID
        ] as ClaimedTaskConsistencyResult | undefined;
        return {
          runId: ctx.workflow.runId,
          taskId: consistency?.taskId ?? null,
          commitMessage: summary?.commitMessage ?? "",
          costUsd: summary?.costUsd ?? null,
          durationMs: summary?.durationMs ?? null,
        };
      },
    },
  ],
};

export default builderWorkflow;
