import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import { resolveAgentRunDirFromContext } from "#core/workflow/agent-run-dir.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { workflowCommandOutput } from "#core/workflow/workflow-command.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import {
  EXPLORATION_REFRESH_MS,
  type ExplorerAssessment,
  explorerAssessmentOperation,
} from "./assessment.js";
import {
  EXPLORER_PUBLICATION_ARTIFACT,
  EXPLORER_PUBLICATION_REQUESTED_EVENT,
  explorerPublicationKey,
} from "./explorer-publication.js";
import {
  decodeExplorerState,
  EXPLORER_STATE_KEY,
  type ExplorerState,
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

export { EXPLORATION_REFRESH_MS } from "./assessment.js";

const inspectQueue = typedCodeStep<ExplorerAssessment>({
  id: "inspect-queue",
  type: "code",
  exposeOutputToAgent: true,
  validate: (raw) =>
    expectStructuredOutput<ExplorerAssessment>(raw, [
      "counts",
      "inboxCount",
      "activeCount",
      "actionableCount",
      "dispatchableCount",
      "hasDispatchableWork",
      "dirty",
      "needsAttention",
      "explorationRefreshDue",
    ]),
  run: ({ workspaceRoot, state, runBlocking }) => {
    const current = decodeExplorerState(
      state.read<ExplorerState>(EXPLORER_STATE_KEY).value,
    );
    return runBlocking(explorerAssessmentOperation, {
      workspaceRoot,
      lastExplorationAt: current.lastExplorationAt,
    });
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
  run: ({ workspaceRoot }) => {
    const file = readWatchlist(workspaceRoot);
    return {
      entries: file.entries.map(summarizeWatchlistEntry),
      updateReportPath: "watchlist-updates.json",
    };
  },
});

const explorerWorkflow: WorkflowDefinitionInput = {
  name: "explorer",
  repository: "write",
  integration: { validationCommand: ["pnpm", "validate-tasks"] },
  description:
    "Search broadly for external ideas and promising improvements when the local queue is empty or running thin.",
  tags: ["monitored"],
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
  ],
  steps: [
    inspectQueue,
    inspectWatchlist,
    {
      id: "explore",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: AUTONOMY_AGENT_DEFAULTS.effort,
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
      when: (ctx) => inspectQueue.outputRequired(ctx).needsAttention,
      repairLoop: {
        checks: [
          {
            id: "task-queue-valid",
            type: "code" as const,
            run: async (ctx) =>
              workflowCommandOutput(
                await ctx.runCommand({
                  command: "pnpm",
                  args: ["run", "validate-tasks"],
                  cwd: ctx.workspaceRoot,
                }),
              ),
          },
          {
            id: "watchlist-update-commit-message",
            type: "code" as const,
            run: (ctx) =>
              checkWatchlistUpdatesCommitMessage(
                resolveAgentRunDirFromContext(ctx),
              ),
          },
        ],
      },
    },
    {
      id: "record-exploration-publication",
      type: "code",
      when: stepSucceeded("explore"),
      run: ({ workflow }) => {
        const exploredAt = new Date().toISOString();
        writeJsonFileAtomic(
          join(workflow.runDirPath, EXPLORER_PUBLICATION_ARTIFACT),
          { exploredAt },
        );
        return { exploredAt };
      },
    },
    {
      id: "emit-exploration-publication",
      type: "emit",
      when: stepSucceeded("record-exploration-publication"),
      event: EXPLORER_PUBLICATION_REQUESTED_EVENT,
      payload: (ctx) => {
        const publicationKey = explorerPublicationKey(ctx.workflow.runId);
        return {
          idempotencyKey: publicationKey,
          publicationKey,
          sourceRunId: ctx.workflow.runId,
        };
      },
    },
    {
      id: "apply-watchlist-updates",
      type: "code",
      when: stepSucceeded("explore"),
      run: (ctx) => {
        const payload = readWatchlistUpdatesFromRun(
          resolveAgentRunDirFromContext(ctx),
        );
        if (!payload) return { applied: [] };
        const applied = applyWatchlistUpdates(ctx.workspaceRoot, payload);
        return { applied };
      },
    },
  ],
};

export default explorerWorkflow;
