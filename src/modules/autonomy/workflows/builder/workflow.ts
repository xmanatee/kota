import type { AgentDef } from "#core/agents/agent-types.js";
import type { RepoTaskQueueSnapshot } from "#core/data/repo-tasks.js";
import { getRepoTaskQueueSnapshot } from "#core/data/repo-tasks.js";
import { assertRepoWorktreeClean, getRepoHeadSha } from "#core/util/repo-worktree.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { typedCodeStep } from "#core/workflow/types.js";
import { commitWorkflowChanges } from "#modules/autonomy/commit.js";
import { stepCommitted, stepSucceeded } from "#modules/autonomy/shared.js";
import type { BranchStepResult, CleanupResult } from "./branch-per-task.js";
import { cleanupMergedBranches, createPullRequest, createTaskBranch } from "./branch-per-task.js";
import { builderRepairChecks } from "./repair-checks.js";
import type { BuilderRunSummary } from "./run-summary.js";
import { writeBuilderRunSummary } from "./run-summary.js";

export const agent: AgentDef = {
  name: "builder",
  role: "Ship one cohesive improvement per run by resuming, pulling, or promoting one normalized task.",
  promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
  model: "claude-opus-4-6",
  tools: { permissionMode: "bypassPermissions" },
  settingSources: ["project"],
};

const inspectReadyQueue = typedCodeStep<RepoTaskQueueSnapshot>({
  id: "inspect-ready-queue",
  type: "code",
  run: ({ projectDir }) => {
    assertRepoWorktreeClean(projectDir);
    return getRepoTaskQueueSnapshot(projectDir);
  },
});

const builderWorkflow: WorkflowDefinitionInput = {
  name: "builder",
  description: "Build KOTA by shipping one cohesive improvement per workflow run.",
  costAnomalyThreshold: 3,
  triggers: [
    {
      event: "autonomy.queue.available",
    },
  ],
  steps: [
    inspectReadyQueue,
    {
      id: "build",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      model: agent.model,
      permissionMode: agent.tools?.permissionMode,
      settingSources: agent.settingSources,
      timeoutMs: 60 * 60 * 1000, // 60 minutes — builder runs can be long
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
      when: (ctx) => inspectReadyQueue.output(ctx).pullableCount > 0,
      repairLoop: {
        maxRepairAttempts: 3,
        checks: builderRepairChecks(),
      },
    },
    {
      id: "check-no-intermediate-commits",
      type: "code",
      when: stepSucceeded("build"),
      run: (ctx) => {
        const startSha = inspectReadyQueue.output(ctx).headSha;
        const currentSha = getRepoHeadSha(ctx.projectDir);
        if (startSha && currentSha && startSha !== currentSha) {
          throw new Error(
            `Builder agent committed directly during its run (${startSha.slice(0, 8)} → ${currentSha.slice(0, 8)}), bypassing the validation gate. ` +
              `Intermediate commits circumvent the repair loop and must not occur. ` +
              `The prompt instructs: stage changes and write commit-message.txt — never run git commit.`,
          );
        }
        return { startSha, currentSha, clean: startSha === currentSha };
      },
    },
    typedCodeStep<BranchStepResult>({
      id: "create-task-branch",
      type: "code",
      when: stepSucceeded("check-no-intermediate-commits"),
      run: (ctx) => createTaskBranch(ctx),
    }),
    {
      id: "commit",
      type: "code",
      when: stepSucceeded("create-task-branch"),
      run: ({ projectDir, workflow }) => commitWorkflowChanges(projectDir, workflow.runDirPath),
    },
    typedCodeStep<BuilderRunSummary>({
      id: "write-run-summary",
      type: "code",
      when: stepCommitted("commit"),
      run: (ctx) => writeBuilderRunSummary(ctx),
    }),
    {
      id: "create-pr",
      type: "code",
      when: (ctx) => {
        if (!stepCommitted("commit")(ctx)) return false;
        const branchInfo = ctx.stepOutputs["create-task-branch"] as BranchStepResult | undefined;
        return branchInfo?.branchPerTask === true;
      },
      run: (ctx) => createPullRequest(ctx),
    },
    typedCodeStep<CleanupResult>({
      id: "cleanup-merged-branches",
      type: "code",
      when: (ctx) => {
        const branchInfo = ctx.stepOutputs["create-task-branch"] as BranchStepResult | undefined;
        return branchInfo?.branchPerTask === true;
      },
      run: (ctx) => cleanupMergedBranches(ctx),
    }),
    {
      id: "emit-build-committed",
      type: "emit",
      when: stepSucceeded("write-run-summary"),
      event: "workflow.build.committed",
      payload: (ctx) => {
        const summary = ctx.stepOutputs["write-run-summary"] as BuilderRunSummary | undefined;
        return {
          runId: ctx.workflow.runId,
          taskId: summary?.taskId ?? null,
          commitMessage: summary?.commitMessage ?? "",
          costUsd: summary?.costUsd ?? null,
          durationMs: summary?.durationMs ?? null,
        };
      },
    },
    {
      id: "request-restart",
      type: "restart",
      when: stepCommitted("commit"),
      reason: "builder workflow finished validation and commit",
      requires: ["commit"],
    },
  ],
};

export default builderWorkflow;
