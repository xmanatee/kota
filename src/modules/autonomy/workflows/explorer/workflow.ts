import type { AgentDef } from "#core/agents/agent-types.js";
import { withWorkflowBlockingOperation } from "#core/workflow/blocking-operation-context.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  onRecoveryTrigger,
  resetWorktreeForRecoveryOperation,
} from "#modules/autonomy/recovery.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  runCheck,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import {
  claimAwareStrategicReadyCoverageOperation,
} from "#modules/autonomy/strategic-ready-coverage.js";
import {
  workflowCommitCheckOperation,
  workflowCommitOperation,
} from "#modules/autonomy/workflow-commit-operations.js";
import { architectureReadyCoverageOperation } from "#modules/repo-tasks/task-queue-validation-operation.js";
import {
  EXPLORATION_REFRESH_MS,
  type ExplorerAssessment,
  explorerAssessmentOperation,
} from "./assessment.js";
import { explorationRationaleCheckOperation } from "./exploration-rationale-operation.js";

export { EXPLORATION_REFRESH_MS } from "./assessment.js";

import { writeLastExplorationAt } from "./explorer-state.js";
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
  run: ({ projectDir, runBlocking }) =>
    runBlocking(explorerAssessmentOperation, { projectDir }),
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
      run: (ctx) =>
        ctx.runBlocking(resetWorktreeForRecoveryOperation, {
          projectDir: ctx.projectDir,
          workflowName: "explorer",
        }),
    },
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
      when: (ctx) => {
        if (ctx.trigger.event === "runtime.recovered") return false;
        return inspectQueue.outputRequired(ctx).needsAttention;
      },
      repairLoop: {
        checks: [
          {
            id: "task-queue-valid",
            type: "code" as const,
            run: (ctx) => runCheck(
              "pnpm run validate-tasks",
              ctx.projectDir,
              { signal: ctx.signal },
            ),
          },
          {
            id: "architecture-ready-coverage",
            type: "code" as const,
            phase: 1,
            run: (ctx) => withWorkflowBlockingOperation(ctx).runBlocking(
              architectureReadyCoverageOperation,
              { projectDir: ctx.projectDir },
            ),
          },
          {
            id: "strategic-ready-coverage",
            type: "code" as const,
            phase: 1,
            run: (ctx) => withWorkflowBlockingOperation(ctx).runBlocking(
              claimAwareStrategicReadyCoverageOperation,
              { projectDir: ctx.projectDir },
            ),
          },
          {
            id: "exploration-rationale",
            type: "code" as const,
            run: async (ctx) => {
              const queue = inspectQueue.outputRequired(ctx);
              const rationale = await withWorkflowBlockingOperation(
                ctx,
              ).runBlocking(explorationRationaleCheckOperation, {
                projectDir: ctx.projectDir,
                runDirPath: ctx.workflow.runDirPath,
                actionableCount: queue.actionableCount,
                strategicReadyCoverageGap: queue.strategicReadyCoverageGap,
              });
              return `exploration-rationale-ok: decision=${rationale.decision}`;
            },
          },
          {
            id: "no-scratch-artifacts",
            type: "code" as const,
            run: (ctx) =>
              withWorkflowBlockingOperation(ctx).runBlocking(workflowCommitCheckOperation, {
                kind: "scratch-artifacts",
                projectDir: ctx.projectDir,
              }),
          },
          {
            id: "watchlist-update-commit-message",
            type: "code" as const,
            run: (ctx) => checkWatchlistUpdatesCommitMessage(ctx.workflow.runDirPath),
          },
          {
            id: "commit-message-exists",
            type: "code" as const,
            run: (ctx) =>
              withWorkflowBlockingOperation(ctx).runBlocking(workflowCommitCheckOperation, {
                kind: "commit-message",
                projectDir: ctx.projectDir,
                runDirPath: ctx.workflow.runDirPath,
              }),
          },
          {
            id: "commit-stageable",
            type: "code" as const,
            run: (ctx) =>
              withWorkflowBlockingOperation(ctx).runBlocking(workflowCommitCheckOperation, {
                kind: "commit-stageable",
                projectDir: ctx.projectDir,
              }),
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
      run: (ctx) =>
        ctx.runBlocking(workflowCommitOperation, {
          projectDir: ctx.projectDir,
          runDirPath: ctx.workflow.runDirPath,
        }),
    },
  ],
};

export default explorerWorkflow;
