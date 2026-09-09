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
  AUTONOMY_AGENT_TIER,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import { resolveRepoWorkSupplyInput } from "#modules/repo-tasks/work-supply.js";
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
import { explorationFingerprint, refreshExplorerSources } from "./source-evidence.js";
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
  run: ({ workspaceRoot, scopeRoot, stateDir, state, runBlocking }) => {
    const current = decodeExplorerState(
      state.read<ExplorerState>(EXPLORER_STATE_KEY).value,
    );
    return runBlocking(explorerAssessmentOperation, {
      ...resolveRepoWorkSupplyInput({ workspaceRoot, scopeRoot, stateDir }),
      lastExplorationAt: current.lastExplorationAt,
    });
  },
});

const inspectWatchlist = typedCodeStep<Awaited<ReturnType<typeof refreshExplorerSources>>>({
  id: "inspect-watchlist",
  type: "code",
  timeoutMs: 15 * 60 * 1000,
  exposeOutputToAgent: true,
  when: (ctx) => inspectQueue.outputRequired(ctx).needsAttention,
  validate: (raw) => expectStructuredOutput<Awaited<ReturnType<typeof refreshExplorerSources>>>(raw,
    ["sources", "observations", "fingerprint", "shouldReview", "reason", "revisit"]),
  run: (ctx) => refreshExplorerSources({
    workspaceRoot: ctx.workspaceRoot,
    current: decodeExplorerState(ctx.state.read<ExplorerState>(EXPLORER_STATE_KEY).value),
    runTool: ctx.runTool,
    capacity: inspectQueue.outputRequired(ctx).capacity,
    artifactDir: resolveAgentRunDirFromContext(ctx),
    evidenceDir: ctx.workflow.runDirPath,
  }),
});

const explorerWorkflow: WorkflowDefinitionInput = {
  name: "explorer",
  repository: "write",
  resources: () => ["autonomy:exploration"],
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
      tier: AUTONOMY_AGENT_TIER,
      effort: AUTONOMY_AGENT_DEFAULTS.effort,
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
      when: (ctx) => inspectWatchlist.output(ctx)?.shouldReview === true,
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
    {
      id: "record-exploration-publication",
      type: "code",
      when: stepSucceeded("inspect-watchlist"),
      run: (ctx) => {
        const evidence = inspectWatchlist.outputRequired(ctx);
        const previous = decodeExplorerState(ctx.state.read<ExplorerState>(EXPLORER_STATE_KEY).value);
        const reviewed = ctx.stepResults.explore?.status === "success";
        const next: ExplorerState = {
          observedAt: new Date().toISOString(),
          lastExplorationAt: reviewed ? new Date().toISOString() : previous.lastExplorationAt,
          lastReviewedFingerprint: reviewed
            ? explorationFingerprint(ctx.workspaceRoot, evidence.sources)
            : previous.lastReviewedFingerprint,
          sources: evidence.sources,
        };
        writeJsonFileAtomic(
          join(ctx.workflow.runDirPath, EXPLORER_PUBLICATION_ARTIFACT),
          next,
        );
        return { reviewed, ...next, revisit: evidence.revisit };
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
  ],
};

export default explorerWorkflow;
