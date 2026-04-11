import type { AgentDef } from "#core/agents/agent-types.js";
import {
  getRepoTaskQueueSnapshot,
  isThinPullQueue,
} from "#core/data/repo-tasks.js";
import { assertRepoWorktreeClean } from "#core/util/repo-worktree.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { typedCodeStep } from "#core/workflow/types.js";
import { commitWorkflowChanges } from "#modules/autonomy/commit.js";
import {
  runCheck,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import {
  assertArchitectureReadyCoverage,
  assertStrategicReadyCoverage,
} from "#modules/repo-tasks/task-queue-validation.js";
import {
  readLastExplorationAt,
  writeLastExplorationAt,
} from "./explorer-state.js";

export const agent: AgentDef = {
  name: "explorer",
  role: "Find strong external ideas and promising new directions when the local queue is empty or running thin.",
  promptPath: "src/modules/autonomy/workflows/explorer/prompt.md",
  model: "claude-opus-4-6",
  tools: { permissionMode: "bypassPermissions" },
  settingSources: ["project"],
};

export const EXPLORATION_REFRESH_MS = 30 * 60 * 1000;

type ExplorerAssessment = {
  counts: ReturnType<typeof getRepoTaskQueueSnapshot>["counts"];
  inboxCount: number;
  openCount: number;
  pullableCount: number;
  actionableCount: number;
  needsAttention: boolean;
  explorationRefreshDue: boolean;
};

function buildExplorerAssessment(
  projectDir: string,
  lastExplorationAt: string | undefined,
): ExplorerAssessment {
  const queue = getRepoTaskQueueSnapshot(projectDir);
  const explorationRefreshDue =
    !lastExplorationAt ||
    Date.now() - new Date(lastExplorationAt).getTime() >= EXPLORATION_REFRESH_MS;
  const queueEmpty = queue.inboxCount === 0 && queue.pullableCount === 0;
  const queueThin = isThinPullQueue(queue);

  return {
    ...queue,
    needsAttention: (queueEmpty || queueThin) && explorationRefreshDue,
    explorationRefreshDue,
  };
}

const inspectQueue = typedCodeStep<ExplorerAssessment>({
  id: "inspect-queue",
  type: "code",
  run: ({ projectDir }) => {
    assertRepoWorktreeClean(projectDir);
    return buildExplorerAssessment(
      projectDir,
      readLastExplorationAt(projectDir),
    );
  },
});

const explorerWorkflow: WorkflowDefinitionInput = {
  name: "explorer",
  description:
    "Search broadly for external ideas and promising improvements when the local queue is empty or running thin.",
  triggers: [
    {
      event: "autonomy.queue.empty",
      cooldownMs: EXPLORATION_REFRESH_MS,
    },
    {
      event: "autonomy.queue.thin",
      cooldownMs: EXPLORATION_REFRESH_MS,
    },
  ],
  steps: [
    inspectQueue,
    {
      id: "explore",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      model: agent.model,
      permissionMode: agent.tools?.permissionMode,
      settingSources: agent.settingSources,
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
          {
            id: "strategic-ready-coverage",
            type: "code",
            run: ({ projectDir }) => assertStrategicReadyCoverage(projectDir),
          },
        ],
      },
    },
    {
      id: "record-exploration",
      type: "code",
      when: stepSucceeded("explore"),
      run: ({ projectDir }) => {
        writeLastExplorationAt(projectDir);
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
