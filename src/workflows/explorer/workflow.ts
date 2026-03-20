import { getRepoTaskQueueSnapshot } from "../../repo-tasks.js";
import type { WorkflowDefinitionInput } from "../../workflow/types.js";
import {
  BACKLOG_TASK_TARGET,
  BUILTIN_WORKFLOW_MODEL,
  READY_TASK_TARGET,
  stepSucceeded,
} from "../shared.js";
import { autoEscalateBlockedTasks } from "./auto-escalate.js";
import { gatherExplorerContext } from "./gather-context.js";

const STRATEGIC_REFRESH_MS = 2 * 60 * 60 * 1000;

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

function shouldRunExplorer(previousOutput: unknown): boolean {
  return Boolean(
    previousOutput &&
      typeof previousOutput === "object" &&
      "needsAttention" in previousOutput &&
      previousOutput.needsAttention === true,
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
      id: "auto-escalate-blocked",
      type: "code",
      run: ({ projectDir }) => autoEscalateBlockedTasks(projectDir),
    },
    {
      id: "gather-context",
      type: "code",
      run: (ctx) => gatherExplorerContext(ctx),
    },
    {
      id: "explore",
      type: "agent",
      promptPath: "src/workflows/explorer/prompt.md",
      model: BUILTIN_WORKFLOW_MODEL,
      permissionMode: "bypassPermissions",
      settingSources: ["project"],
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
      when: ({ previousOutput }) => shouldRunExplorer(previousOutput),
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
