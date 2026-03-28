import { getRepoTaskQueueSnapshot } from "../../repo-tasks.js";
import {
  assertTaskQueueRecommendations,
  assertTaskQueueValid,
} from "../../task-queue-validation.js";
import type { WorkflowDefinitionInput } from "../../workflow/types.js";
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

function shouldRunExplorer(stepOutputs: Record<string, unknown>): boolean {
  const inspectOutput = stepOutputs["inspect-queue"];
  return Boolean(
    inspectOutput &&
      typeof inspectOutput === "object" &&
      "needsAttention" in inspectOutput &&
      inspectOutput.needsAttention === true,
  );
}

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
    {
      id: "inspect-queue",
      type: "code",
      run: ({ projectDir, readRuntimeState }) => {
        return buildExplorerAssessment(
          projectDir,
          readRuntimeState().workflows.explorer?.lastCompletedAt,
        );
      },
    },
    {
      id: "explore",
      type: "agent",
      agentName: "explorer",
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
      when: ({ stepOutputs }) => shouldRunExplorer(stepOutputs),
      repairLoop: {
        maxRepairAttempts: 2,
        checks: [
          {
            id: "task-queue-valid",
            type: "code",
            run: ({ projectDir }) => assertTaskQueueValid(projectDir, { minReady: 1 }),
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
