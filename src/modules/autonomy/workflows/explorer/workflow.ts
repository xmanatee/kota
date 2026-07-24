import type { AgentDef } from "#core/agents/agent-types.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { checkCommitStageable, commitWorkflowChanges } from "#modules/autonomy/commit.js";
import {
  getClaimAwareRepoTaskQueueSnapshot,
  isThinClaimAwareDispatchableQueue,
} from "#modules/autonomy/queue-availability.js";
import {
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  AUTONOMY_AGENT_HARNESS,
  AUTONOMY_DISALLOWED_TOOLS,
  checkCommitMessageExists,
  checkNoScratchArtifacts,
  runCheck,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import {
  assertClaimAwareStrategicReadyCoverage,
  hasClaimAwareStrategicReadyCoverageGapForQueue,
} from "#modules/autonomy/strategic-ready-coverage.js";
import {
  assertArchitectureReadyCoverage,
} from "#modules/repo-tasks/task-queue-validation.js";
import {
  checkExplorationRationale,
  listStrategicBlockedAlternatives,
  type StrategicBlockedSummary,
} from "./exploration-rationale.js";
import {
  readLastExplorationAt,
  writeLastExplorationAt,
} from "./explorer-state.js";
import { readWatchlist, type WatchlistEntry } from "./watchlist.js";
import {
  applyWatchlistUpdates,
  checkWatchlistUpdatesCommitMessage,
  readWatchlistUpdatesFromRun,
} from "./watchlist-updates.js";

export const agent: AgentDef = {
  name: "explorer",
  role: "Find strong external ideas and promising new directions when the local queue is empty or running thin.",
  promptPath: "src/modules/autonomy/workflows/explorer/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  writeScope: ["data/tasks/", "data/watchlist.yaml"],
};

export const EXPLORATION_REFRESH_MS = 30 * 60 * 1000;

type ExplorerAssessment = {
  counts: ReturnType<typeof getClaimAwareRepoTaskQueueSnapshot>["counts"];
  inboxCount: number;
  openCount: number;
  pullableCount: number;
  actionableCount: number;
  promotableBacklogCount: number;
  dispatchableCount: number;
  hasDispatchableWork: boolean;
  dirty: boolean;
  needsAttention: boolean;
  explorationRefreshDue: boolean;
  strategicReadyCoverageGap: boolean;
  /**
   * Strategic-area blocked tasks the explorer must consider before opening
   * unrelated narrow work. Surfaces existing blocked architecture/core/
   * modules/autonomy work with parsed precondition kinds so the agent can
   * choose to promote/decompose rather than seeding new fan-out tasks.
   */
  strategicBlockedAlternatives: StrategicBlockedSummary[];
};

function buildExplorerAssessment(
  projectDir: string,
  lastExplorationAt: string | undefined,
): ExplorerAssessment {
  const worktree = getRepoWorktreeStatus(projectDir);
  const dirty = worktree.available && worktree.dirty;
  const queue = getClaimAwareRepoTaskQueueSnapshot(projectDir);
  const explorationRefreshDue =
    !lastExplorationAt ||
    Date.now() - new Date(lastExplorationAt).getTime() >= EXPLORATION_REFRESH_MS;
  const queueEmpty = !queue.hasDispatchableWork;
  const queueThin = isThinClaimAwareDispatchableQueue(queue);
  const locallyBlocked =
    queue.claimBlockedTasks.length > 0 ||
    queue.dependencyBlockedTasks.length > 0;

  return {
    ...queue,
    dirty,
    needsAttention: !dirty && !locallyBlocked && (queueEmpty || queueThin) && explorationRefreshDue,
    explorationRefreshDue,
    strategicReadyCoverageGap: hasClaimAwareStrategicReadyCoverageGapForQueue(
      projectDir,
      queue,
    ),
    strategicBlockedAlternatives: listStrategicBlockedAlternatives(projectDir),
  };
}

const inspectQueue = typedCodeStep<ExplorerAssessment>({
  id: "inspect-queue",
  type: "code",
  exposeOutputToAgent: true,
  validate: (raw) =>
    expectStructuredOutput<ExplorerAssessment>(raw, [
      "counts",
      "inboxCount",
      "openCount",
      "pullableCount",
      "actionableCount",
      "promotableBacklogCount",
      "dispatchableCount",
      "hasDispatchableWork",
      "dirty",
      "needsAttention",
      "explorationRefreshDue",
      "strategicReadyCoverageGap",
      "strategicBlockedAlternatives",
    ]),
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
  canonicalizedFrom?: string[];
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
    return {
      url: entry.url,
      added: entry.added,
      ...(entry.canonicalizedFrom !== undefined
        ? { canonicalizedFrom: entry.canonicalizedFrom }
        : {}),
      status: "inaccessible",
    };
  }
  if (!entry.snapshot) {
    return {
      url: entry.url,
      added: entry.added,
      ...(entry.canonicalizedFrom !== undefined
        ? { canonicalizedFrom: entry.canonicalizedFrom }
        : {}),
      status: "never-seen",
    };
  }
  return {
    url: entry.url,
    added: entry.added,
    ...(entry.canonicalizedFrom !== undefined
      ? { canonicalizedFrom: entry.canonicalizedFrom }
      : {}),
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
  validate: (raw) =>
    expectStructuredOutput<WatchlistInspection>(raw, ["entries", "updateReportPath"]),
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
      harness: AUTONOMY_AGENT_HARNESS,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: agent.effort,
      disallowedTools: AUTONOMY_DISALLOWED_TOOLS,
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
      when: (ctx) => {
        if (ctx.trigger.event === "runtime.recovered") return false;
        return inspectQueue.outputRequired(ctx).needsAttention;
      },
      repairLoop: {
        checks: [
          {
            id: "task-queue-valid",
            type: "code" as const,
            run: (ctx) => runCheck("pnpm run validate-tasks", ctx.projectDir),
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
            run: ({ projectDir }) => assertClaimAwareStrategicReadyCoverage(projectDir),
          },
          {
            id: "exploration-rationale",
            type: "code" as const,
            run: (ctx) => {
              const queue = inspectQueue.outputRequired(ctx);
              const rationale = checkExplorationRationale(
                ctx.projectDir,
                ctx.workflow.runDirPath,
                {
                  actionableCount: queue.actionableCount,
                  strategicReadyCoverageGap: queue.strategicReadyCoverageGap,
                },
              );
              return `exploration-rationale-ok: decision=${rationale.decision}`;
            },
          },
          {
            id: "no-scratch-artifacts",
            type: "code" as const,
            run: (ctx) => checkNoScratchArtifacts(ctx.projectDir),
          },
          {
            id: "watchlist-update-commit-message",
            type: "code" as const,
            run: (ctx) => checkWatchlistUpdatesCommitMessage(ctx.workflow.runDirPath),
          },
          {
            id: "commit-message-exists",
            type: "code" as const,
            run: (ctx) => checkCommitMessageExists(ctx.workflow.runDirPath, ctx.projectDir),
          },
          {
            id: "commit-stageable",
            type: "code" as const,
            run: (ctx) => checkCommitStageable(ctx.projectDir),
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
