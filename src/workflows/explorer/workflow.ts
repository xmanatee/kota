import { getRepoTaskQueueSnapshot } from "../../repo-tasks.js";
import type { WorkflowDefinitionInput } from "../../workflow/types.js";
import {
  BACKLOG_TASK_TARGET,
  READY_TASK_TARGET,
  stepSucceeded,
} from "../shared.js";
import { autoEscalateBlockedTasks } from "./auto-escalate.js";

const STRATEGIC_REFRESH_MS = 60 * 60 * 1000;

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
  dailyBudgetUsd: 5,
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
      id: "auto-escalate-blocked",
      type: "code",
      run: ({ projectDir }) => autoEscalateBlockedTasks(projectDir),
    },
    {
      id: "explore",
      type: "agent",
      agentName: "explorer",
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
      when: ({ stepOutputs }) => shouldRunExplorer(stepOutputs),
    },
    {
      id: "verify-task-files",
      type: "tool",
      tool: "shell",
      when: stepSucceeded("explore"),
      input: {
        command: "npm test -- src/task-files.test.ts",
        stream_output: false,
      },
    },
  ],
};

export default explorerWorkflow;
