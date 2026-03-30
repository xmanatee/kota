import {
  getRepoTaskQueueSnapshot,
  isRepoTaskQueueSnapshot,
} from "../../repo-tasks.js";
import { assertRepoWorktreeClean } from "../../repo-worktree.js";
import { assertTaskQueueValid } from "../../task-queue-validation.js";
import type { WorkflowDefinitionInput } from "../../workflow/types.js";
import { commitWorkflowChanges } from "../commit.js";
import { stepCommitted, stepSucceeded } from "../shared.js";

function shouldRunBuilder(stepOutputs: Record<string, unknown>): boolean {
  const inspectOutput = stepOutputs["inspect-ready-queue"];
  return Boolean(
    inspectOutput &&
      typeof inspectOutput === "object" &&
      "actionableCount" in inspectOutput &&
      typeof inspectOutput.actionableCount === "number" &&
      inspectOutput.actionableCount > 0,
  );
}

const builderWorkflow: WorkflowDefinitionInput = {
  name: "builder",
  description: "Build KOTA by shipping one cohesive improvement per workflow run.",
  triggers: [
    {
      event: "workflow.completed",
      filter: {
        workflow: "explorer",
        status: "success",
      },
    },
  ],
  steps: [
    {
      id: "inspect-ready-queue",
      type: "code",
      run: ({ projectDir }) => {
        assertRepoWorktreeClean(projectDir);
        return getRepoTaskQueueSnapshot(projectDir);
      },
    },
    {
      id: "build",
      type: "agent",
      agentName: "builder",
      timeoutMs: 60 * 60 * 1000, // 60 minutes — builder runs can be long
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
      when: ({ stepOutputs }) =>
        isRepoTaskQueueSnapshot(stepOutputs["inspect-ready-queue"]) &&
        shouldRunBuilder(stepOutputs),
      repairLoop: {
        maxRepairAttempts: 3,
        checks: [
          {
            id: "task-queue-valid",
            type: "code",
            run: ({ projectDir }) => assertTaskQueueValid(projectDir),
          },
          {
            id: "typecheck",
            tool: "shell",
            input: (ctx) => ({
              command: "npm run typecheck",
              stream_output: false,
              cwd: ctx.projectDir,
            }),
          },
          {
            id: "lint",
            tool: "shell",
            input: (ctx) => ({
              command: "npm run lint",
              stream_output: false,
              cwd: ctx.projectDir,
            }),
          },
          {
            id: "test",
            tool: "shell",
            input: (ctx) => ({
              command: "npm test",
              stream_output: false,
              timeout_ms: 300_000,
              cwd: ctx.projectDir,
            }),
          },
          {
            id: "build-output",
            tool: "shell",
            input: (ctx) => ({
              command: "npm run build",
              stream_output: false,
              cwd: ctx.projectDir,
            }),
          },
        ],
      },
    },
    {
      id: "commit",
      type: "code",
      when: stepSucceeded("build"),
      run: ({ projectDir, workflow }) => commitWorkflowChanges(projectDir, workflow.runDirPath),
    },
    {
      id: "request-restart",
      type: "restart",
      when: stepCommitted("commit"),
      reason: "builder workflow finished validation and commit",
      requires: ["commit"],
    },
  ],
};

export default builderWorkflow;
