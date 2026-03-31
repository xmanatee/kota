import { getRepoTaskQueueSnapshot } from "../../repo-tasks.js";
import { assertRepoWorktreeClean } from "../../repo-worktree.js";
import {
  assertNoHighPriorityBacklogStrandedTasks,
  assertTaskQueueRecommendations,
} from "../../task-queue-validation.js";
import type { WorkflowDefinitionInput } from "../../workflow/types.js";
import { typedCodeStep } from "../../workflow/types.js";
import { autoResetDirtyWorktree } from "../builder/dirty-state-recovery.js";
import { commitWorkflowChanges } from "../commit.js";
import {
  BACKLOG_TASK_TARGET,
  READY_TASK_TARGET,
  stepSucceeded,
} from "../shared.js";

const STRATEGIC_REFRESH_MS = 30 * 60 * 1000;

type ExplorerAssessment = {
  counts: ReturnType<typeof getRepoTaskQueueSnapshot>["counts"];
  openCount: number;
  actionableCount: number;
  needsAttention: boolean;
  strategicRefreshDue: boolean;
};

function buildExplorerAssessment(
  projectDir: string,
  lastCompletedAt: string | undefined,
): ExplorerAssessment {
  const queue = getRepoTaskQueueSnapshot(projectDir);
  const strategicRefreshDue =
    !lastCompletedAt ||
    Date.now() - new Date(lastCompletedAt).getTime() >= STRATEGIC_REFRESH_MS;

  return {
    ...queue,
    needsAttention:
      queue.counts.inbox > 0 ||
      queue.counts.ready < READY_TASK_TARGET ||
      queue.counts.backlog < BACKLOG_TASK_TARGET ||
      strategicRefreshDue,
    strategicRefreshDue,
  };
}

const inspectQueue = typedCodeStep<ExplorerAssessment>({
  id: "inspect-queue",
  type: "code",
  run: ({ projectDir, readRuntimeState }) => {
    autoResetDirtyWorktree(projectDir, (msg) => console.warn(msg));
    assertRepoWorktreeClean(projectDir);
    return buildExplorerAssessment(
      projectDir,
      readRuntimeState().workflows.explorer?.lastCompletedAt,
    );
  },
});

const explorerWorkflow: WorkflowDefinitionInput = {
  name: "explorer",
  description:
    "Maintain a strong, deduplicated task portfolio by studying the codebase, recent work, and external ideas.",
  triggers: [
    {
      event: "runtime.idle",
      cooldownMs: 30_000,
    },
  ],
  steps: [
    inspectQueue,
    {
      id: "explore",
      type: "agent",
      agentName: "explorer",
      timeoutMs: 45 * 60 * 1000, // 45 minutes — explorer can do broad external research
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
      when: (ctx) => inspectQueue.output(ctx).needsAttention,
      repairLoop: {
        maxRepairAttempts: 2,
        checks: [
          {
            id: "task-queue-valid",
            tool: "shell",
            input: (ctx) => ({
              command: "npm run validate-tasks -- --min-ready 1",
              stream_output: false,
              cwd: ctx.projectDir,
            }),
          },
          {
            id: "task-queue-range",
            type: "code",
            severity: "warning",
            run: ({ projectDir }) =>
              assertTaskQueueRecommendations(projectDir, {
                recommendedMinReady: READY_TASK_TARGET,
                recommendedMinBacklog: BACKLOG_TASK_TARGET,
              }),
          },
          {
            id: "high-priority-placement",
            type: "code",
            run: ({ projectDir }) =>
              assertNoHighPriorityBacklogStrandedTasks(projectDir, {
                recommendedMinReady: READY_TASK_TARGET,
              }),
          },
        ],
      },
    },
    {
      id: "commit",
      type: "code",
      when: stepSucceeded("explore"),
      run: ({ projectDir, workflow }) => commitWorkflowChanges(projectDir, workflow.runDirPath),
    },
  ],
};

export default explorerWorkflow;
