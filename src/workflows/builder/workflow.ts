import type { RepoTaskQueueSnapshot } from "../../repo-tasks.js";
import { getRepoTaskQueueSnapshot } from "../../repo-tasks.js";
import { assertRepoWorktreeClean } from "../../repo-worktree.js";
import type { WorkflowDefinitionInput } from "../../workflow/types.js";
import { typedCodeStep } from "../../workflow/types.js";
import { commitWorkflowChanges } from "../commit.js";
import { runCheck, stepCommitted, stepSucceeded } from "../shared.js";
import type { BuilderRunSummary } from "./run-summary.js";
import { writeBuilderRunSummary } from "./run-summary.js";

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
  triggers: [
    {
      event: "workflow.completed",
      filter: {
        workflow: "explorer",
        status: "success",
      },
    },
  ],
  steps: [
    inspectReadyQueue,
    {
      id: "build",
      type: "agent",
      agentName: "builder",
      timeoutMs: 60 * 60 * 1000, // 60 minutes — builder runs can be long
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
      when: (ctx) => inspectReadyQueue.output(ctx).actionableCount > 0,
      repairLoop: {
        maxRepairAttempts: 3,
        checks: [
          {
            id: "build-output",
            type: "code" as const,
            run: (ctx) => runCheck("npm run build", ctx.projectDir),
          },
          {
            id: "task-queue-valid",
            type: "code" as const,
            run: (ctx) => runCheck("npm run validate-tasks", ctx.projectDir),
          },
          {
            id: "typecheck",
            type: "code" as const,
            run: (ctx) => runCheck("npm run typecheck", ctx.projectDir),
          },
          {
            id: "lint",
            type: "code" as const,
            run: (ctx) => runCheck("npm run lint", ctx.projectDir),
          },
          {
            id: "test",
            type: "code" as const,
            run: (ctx) => runCheck("npm test", ctx.projectDir, 300_000),
          },
        ],
      },
    },
    {
      id: "commit",
      type: "code",
      when: stepSucceeded("build"),
      run: ({ projectDir, workflow }) => commitWorkflowChanges(projectDir, workflow.runDirPath),
    },
    typedCodeStep<BuilderRunSummary>({
      id: "write-run-summary",
      type: "code",
      when: stepCommitted("commit"),
      run: (ctx) => writeBuilderRunSummary(ctx),
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
