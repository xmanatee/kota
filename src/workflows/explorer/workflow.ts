import { getRepoTaskQueueSnapshot } from "../../repo-tasks.js";
import { assertRepoWorktreeClean } from "../../repo-worktree.js";
import {
  assertArchitectureReadyCoverage,
  assertNoHighPriorityBacklogStrandedTasks,
  assertTaskQueueRecommendations,
  hasArchitectureReadyCoverageGap,
  hasHighPriorityBacklogTasks,
} from "../../task-queue-validation.js";
import type { WorkflowDefinitionInput } from "../../workflow/types.js";
import { typedCodeStep } from "../../workflow/types.js";
import { commitWorkflowChanges } from "../commit.js";
import {
  BACKLOG_TASK_TARGET,
  READY_TASK_TARGET,
  runCheck,
  stepSucceeded,
} from "../shared.js";

const STRATEGIC_REFRESH_MS = 30 * 60 * 1000;

type ExplorerAssessment = {
  counts: ReturnType<typeof getRepoTaskQueueSnapshot>["counts"];
  openCount: number;
  actionableCount: number;
  needsAttention: boolean;
  strategicRefreshDue: boolean;
  hasHighPriorityBacklogTasks: boolean;
  hasArchitectureReadyGap: boolean;
};

function buildExplorerAssessment(
  projectDir: string,
  lastCompletedAt: string | undefined,
): ExplorerAssessment {
  const queue = getRepoTaskQueueSnapshot(projectDir);
  const strategicRefreshDue =
    !lastCompletedAt ||
    Date.now() - new Date(lastCompletedAt).getTime() >= STRATEGIC_REFRESH_MS;
  const highPriorityInBacklog = hasHighPriorityBacklogTasks(projectDir);
  const architectureReadyGap = hasArchitectureReadyCoverageGap(projectDir);

  return {
    ...queue,
    hasHighPriorityBacklogTasks: highPriorityInBacklog,
    hasArchitectureReadyGap: architectureReadyGap,
    needsAttention:
      queue.counts.inbox > 0 ||
      queue.counts.ready < READY_TASK_TARGET ||
      queue.counts.backlog < BACKLOG_TASK_TARGET ||
      highPriorityInBacklog ||
      strategicRefreshDue ||
      architectureReadyGap,
    strategicRefreshDue,
  };
}

const inspectQueue = typedCodeStep<ExplorerAssessment>({
  id: "inspect-queue",
  type: "code",
  run: ({ projectDir, readRuntimeState }) => {
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
            type: "code" as const,
            run: (ctx) => runCheck("npm run validate-tasks -- --min-ready 1", ctx.projectDir),
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
          {
            id: "architecture-ready-coverage",
            type: "code",
            run: ({ projectDir }) => assertArchitectureReadyCoverage(projectDir),
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
