import type { AgentDef } from "#core/agents/agent-types.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { commitWorkflowChanges } from "#modules/autonomy/commit.js";
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
  AUTONOMY_AGENT_HARNESS,
  AUTONOMY_BUILDER_AGENT_HANG_TIMEOUT_MS,
  AUTONOMY_BUILDER_AGENT_IDLE_TIMEOUT_MS,
  AUTONOMY_DISALLOWED_TOOLS,
  stepCommitted,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import type { RepoTaskQueueSnapshot } from "#modules/repo-tasks/repo-tasks-domain.js";
import { getRepoTaskQueueSnapshot } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { BranchStepResult, CleanupResult } from "./branch-per-task.js";
import { cleanupMergedBranches, createPullRequest, createTaskBranch } from "./branch-per-task.js";
import {
  CLAIMED_TASK_CONSISTENCY_STEP_ID,
  type ClaimedTaskConsistencyResult,
  claimedTaskConsistencySucceeded,
  createClaimedTaskConsistencyStep,
} from "./claimed-task-consistency-step.js";
import {
  createCleanupAutomationWorktreeStep,
  createMergeGateStep,
} from "./merge-gate-step.js";
import {
  type BuilderWorkspaceResult,
  createPrepareBuilderWorktreeStep,
} from "./prepare-worktree-step.js";
import { builderRepairChecks } from "./repair-checks.js";
import type { BuilderRunSummary } from "./run-summary.js";
import { writeBuilderRunSummary } from "./run-summary.js";
import {
  createClaimTaskStep,
  createMarkClaimPendingMergeStep,
  createReleaseTaskClaimStep,
} from "./task-claim-step.js";
import { workflowWorkspaceDir } from "./workspace.js";

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

type InspectResult = RepoTaskQueueSnapshot & { dirty: boolean };

const inspectReadyQueue = typedCodeStep<InspectResult>({
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
    const dirty = worktree.available && worktree.trackedDirty;
    return { ...getRepoTaskQueueSnapshot(ctx.projectDir), dirty };
  },
});

const claimTaskStep = createClaimTaskStep(inspectReadyQueue);
const prepareWorktreeStep = createPrepareBuilderWorktreeStep(claimTaskStep);
const claimedTaskConsistencyStep = createClaimedTaskConsistencyStep(claimTaskStep);
const mergeGateStep = createMergeGateStep();
const cleanupAutomationWorktreeStep = createCleanupAutomationWorktreeStep();

const builderWorkflow: WorkflowDefinitionInput = {
  name: "builder",
  description: "Build KOTA by shipping one cohesive improvement per workflow run.",
  tags: ["monitored"],
  recoveryCapable: true,
  defaultAutonomyMode: "autonomous",
  triggers: [
    {
      event: "autonomy.queue.available",
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
    inspectReadyQueue,
    claimTaskStep,
    prepareWorktreeStep,
    {
      id: "build",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      harness: AUTONOMY_AGENT_HARNESS,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: agent.effort,
      disallowedTools: AUTONOMY_DISALLOWED_TOOLS,
      timeoutMs: AUTONOMY_BUILDER_AGENT_HANG_TIMEOUT_MS,
      idleTimeoutMs: AUTONOMY_BUILDER_AGENT_IDLE_TIMEOUT_MS,
      when: (ctx) => {
        if (ctx.trigger.event === "runtime.recovered") return false;
        // Builder runs only on actionable (ready + doing) work. A backlog-only
        // queue is shaped by `backlog-promoter` first so the build agent never
        // silently consumes reserve work.
        const { dirty, actionableCount } = inspectReadyQueue.outputRequired(ctx);
        const claim = claimTaskStep.output(ctx);
        const workspace = prepareWorktreeStep.output(ctx);
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
      run: (ctx) => commitWorkflowChanges(workflowWorkspaceDir(ctx), ctx.workflow.runDirPath),
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
      run: (ctx) => writeCalibrationArtifact(ctx),
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
    {
      id: "emit-build-committed",
      type: "emit",
      when: (ctx) =>
        claimedTaskConsistencySucceeded(ctx) &&
        stepCommitted("commit")(ctx) &&
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
    {
      id: "request-restart",
      type: "restart",
      when: (ctx) => claimedTaskConsistencySucceeded(ctx) && stepCommitted("commit")(ctx),
      reason: "builder workflow finished validation and commit",
      requires: ["commit", CLAIMED_TASK_CONSISTENCY_STEP_ID],
    },
  ],
};

export default builderWorkflow;
