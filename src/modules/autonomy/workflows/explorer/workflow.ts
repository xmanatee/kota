import type { AgentDef } from "#core/agents/agent-types.js";
import {
  getRepoTaskQueueSnapshot,
  isThinPullQueue,
} from "#core/data/repo-tasks.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { typedCodeStep } from "#core/workflow/types.js";
import { commitWorkflowChanges } from "#modules/autonomy/commit.js";
import { recallForExplorer } from "#modules/autonomy/knowledge-recall.js";
import {
  onNormalTrigger,
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import {
  AUTONOMY_DISALLOWED_TOOLS,
  checkCommitMessageExists,
  checkNoScratchArtifacts,
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
  model: "claude-opus-4-7",
  effort: "xhigh",
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
  dirty: boolean;
  needsAttention: boolean;
  explorationRefreshDue: boolean;
};

function buildExplorerAssessment(
  projectDir: string,
  lastExplorationAt: string | undefined,
): ExplorerAssessment {
  const worktree = getRepoWorktreeStatus(projectDir);
  const dirty = worktree.available && worktree.trackedDirty;
  const queue = getRepoTaskQueueSnapshot(projectDir);
  const explorationRefreshDue =
    !lastExplorationAt ||
    Date.now() - new Date(lastExplorationAt).getTime() >= EXPLORATION_REFRESH_MS;
  const queueEmpty = queue.inboxCount === 0 && queue.pullableCount === 0;
  const queueThin = isThinPullQueue(queue);

  return {
    ...queue,
    dirty,
    needsAttention: !dirty && (queueEmpty || queueThin) && explorationRefreshDue,
    explorationRefreshDue,
  };
}

const inspectQueue = typedCodeStep<ExplorerAssessment>({
  id: "inspect-queue",
  type: "code",
  exposeOutputToAgent: true,
  run: ({ projectDir }) => {
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
  tags: ["monitored"],
  recoveryCapable: true,
  triggers: [
    {
      event: "autonomy.queue.empty",
      cooldownMs: EXPLORATION_REFRESH_MS,
    },
    {
      event: "autonomy.queue.thin",
      cooldownMs: EXPLORATION_REFRESH_MS,
    },
    {
      event: "runtime.recovered",
    },
  ],
  steps: [
    {
      id: "reset-for-recovery",
      type: "code",
      when: onRecoveryTrigger,
      run: ({ projectDir }) =>
        resetWorktreeForRecovery({ projectDir, workflowName: "explorer" }),
    },
    inspectQueue,
    {
      id: "recall-knowledge",
      type: "code",
      when: onNormalTrigger,
      exposeOutputToAgent: true,
      run: ({ projectDir }) => recallForExplorer(projectDir),
    },
    {
      id: "explore",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      model: agent.model,
      effort: agent.effort,
      permissionMode: agent.tools?.permissionMode,
      settingSources: agent.settingSources,
      disallowedTools: AUTONOMY_DISALLOWED_TOOLS,
      // Explorer can do broad external research; 45 min covers realistic
      // deep-dive sessions without letting stuck exploration run unbounded.
      timeoutMs: 45 * 60 * 1000,
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
      when: (ctx) => {
        if (ctx.trigger.event === "runtime.recovered") return false;
        return inspectQueue.output(ctx).needsAttention;
      },
      repairLoop: {
        checks: [
          {
            id: "task-queue-valid",
            type: "code" as const,
            run: (ctx) => runCheck("pnpm run validate-tasks -- --min-ready 1", ctx.projectDir),
          },
          {
            id: "architecture-ready-coverage",
            type: "code" as const,
            phase: 1,
            run: ({ projectDir }) => assertArchitectureReadyCoverage(projectDir),
          },
          {
            id: "strategic-ready-coverage",
            type: "code" as const,
            phase: 1,
            run: ({ projectDir }) => assertStrategicReadyCoverage(projectDir),
          },
          {
            id: "no-scratch-artifacts",
            type: "code" as const,
            run: (ctx) => checkNoScratchArtifacts(ctx.projectDir),
          },
          {
            id: "commit-message-exists",
            type: "code" as const,
            run: (ctx) => checkCommitMessageExists(ctx.workflow.runDirPath, ctx.projectDir),
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
