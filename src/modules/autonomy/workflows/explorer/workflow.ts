import type { AgentDef } from "#core/agents/agent-types.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { typedCodeStep } from "#core/workflow/types.js";
import { commitWorkflowChanges } from "#modules/autonomy/commit.js";
import {
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  AUTONOMY_DISALLOWED_TOOLS,
  checkCommitMessageExists,
  checkNoScratchArtifacts,
  runCheck,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import {
  getRepoTaskQueueSnapshot,
  isThinPullQueue,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  assertArchitectureReadyCoverage,
  assertStrategicReadyCoverage,
  hasStrategicReadyCoverageGap,
} from "#modules/repo-tasks/task-queue-validation.js";
import {
  readLastExplorationAt,
  writeLastExplorationAt,
} from "./explorer-state.js";
import { readWatchlist, type WatchlistEntry } from "./watchlist.js";
import {
  applyWatchlistUpdates,
  readWatchlistUpdatesFromRun,
} from "./watchlist-updates.js";

export const agent: AgentDef = {
  name: "explorer",
  role: "Find strong external ideas and promising new directions when the local queue is empty or running thin.",
  promptPath: "src/modules/autonomy/workflows/explorer/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  tools: { permissionMode: "bypassPermissions" },
  writeScope: ["data/tasks/", "data/watchlist.yaml"],
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
  strategicReadyCoverageGap: boolean;
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
    strategicReadyCoverageGap: hasStrategicReadyCoverageGap(projectDir),
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

type WatchlistEntrySummary = {
  url: string;
  added: string;
  status: "inaccessible" | "never-seen" | "seen";
  last_seen_at?: string;
  fingerprint?: string;
  summary?: string;
};

type WatchlistInspection = {
  entries: WatchlistEntrySummary[];
  updateReportPath: string;
};

function summarizeWatchlistEntry(entry: WatchlistEntry): WatchlistEntrySummary {
  if (entry.status === "inaccessible") {
    return { url: entry.url, added: entry.added, status: "inaccessible" };
  }
  if (!entry.snapshot) {
    return { url: entry.url, added: entry.added, status: "never-seen" };
  }
  return {
    url: entry.url,
    added: entry.added,
    status: "seen",
    last_seen_at: entry.snapshot.last_seen_at,
    fingerprint: entry.snapshot.fingerprint,
    summary: entry.snapshot.summary,
  };
}

const inspectWatchlist = typedCodeStep<WatchlistInspection>({
  id: "inspect-watchlist",
  type: "code",
  exposeOutputToAgent: true,
  run: ({ projectDir }) => {
    const file = readWatchlist(projectDir);
    return {
      entries: file.entries.map(summarizeWatchlistEntry),
      updateReportPath: "watchlist-updates.json",
    };
  },
});

const explorerWorkflow: WorkflowDefinitionInput = {
  name: "explorer",
  description:
    "Search broadly for external ideas and promising improvements when the local queue is empty or running thin.",
  tags: ["monitored"],
  recoveryCapable: true,
  defaultAutonomyMode: "autonomous",
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
    inspectWatchlist,
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
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
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
      id: "apply-watchlist-updates",
      type: "code",
      when: stepSucceeded("explore"),
      run: ({ projectDir, workflow }) => {
        const payload = readWatchlistUpdatesFromRun(workflow.runDirPath);
        if (!payload) return { applied: [] };
        const applied = applyWatchlistUpdates(projectDir, payload);
        return { applied };
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
