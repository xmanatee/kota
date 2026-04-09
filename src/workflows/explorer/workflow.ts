import { getRepoTaskQueueSnapshot } from "../../repo-tasks.js";
import { assertRepoWorktreeClean } from "../../repo-worktree.js";
import {
  assertArchitectureReadyCoverage,
} from "../../task-queue-validation.js";
import type { WorkflowDefinitionInput } from "../../workflow/types.js";
import { typedCodeStep } from "../../workflow/types.js";
import { commitWorkflowChanges } from "../commit.js";
import {
  runCheck,
  stepSucceeded,
} from "../shared.js";

const EXPLORATION_REFRESH_MS = 30 * 60 * 1000;

type ExplorerAssessment = {
  counts: ReturnType<typeof getRepoTaskQueueSnapshot>["counts"];
  inboxCount: number;
  openCount: number;
  actionableCount: number;
  needsAttention: boolean;
  explorationRefreshDue: boolean;
};

function buildExplorerAssessment(
  projectDir: string,
  lastCompletedAt: string | undefined,
): ExplorerAssessment {
  const queue = getRepoTaskQueueSnapshot(projectDir);
  const explorationRefreshDue =
    !lastCompletedAt ||
    Date.now() - new Date(lastCompletedAt).getTime() >= EXPLORATION_REFRESH_MS;
  const queueEmpty =
    queue.inboxCount === 0 &&
    queue.counts.ready === 0 &&
    queue.counts.backlog === 0;

  return {
    ...queue,
    needsAttention: queueEmpty && explorationRefreshDue,
    explorationRefreshDue,
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
    "Search broadly for external ideas and promising improvements when the local queue is empty.",
  triggers: [
    {
      event: "runtime.idle",
      cooldownMs: 5 * 60 * 1000,
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
            run: (ctx) => runCheck("pnpm run validate-tasks -- --min-ready 1", ctx.projectDir),
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
