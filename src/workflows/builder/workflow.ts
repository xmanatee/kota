import type { RepoTaskQueueSnapshot } from "../../repo-tasks.js";
import { getRepoTaskQueueSnapshot } from "../../repo-tasks.js";
import { assertRepoWorktreeClean } from "../../repo-worktree.js";
import type { WorkflowDefinitionInput } from "../../workflow/types.js";
import { typedCodeStep } from "../../workflow/types.js";
import { commitWorkflowChanges } from "../commit.js";
import { stepCommitted, stepSucceeded } from "../shared.js";
import { autoResetDirtyWorktree } from "./dirty-state-recovery.js";
import type { BuilderRunSummary } from "./run-summary.js";
import { writeBuilderRunSummary } from "./run-summary.js";

const inspectReadyQueue = typedCodeStep<RepoTaskQueueSnapshot>({
  id: "inspect-ready-queue",
  type: "code",
  run: ({ projectDir }) => {
    autoResetDirtyWorktree(projectDir, (msg) => console.warn(msg));
    assertRepoWorktreeClean(projectDir);
    return getRepoTaskQueueSnapshot(projectDir);
  },
});

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
    inspectReadyQueue,
    {
      id: "build",
      type: "agent",
      agentName: "builder",
      timeoutMs: 60 * 60 * 1000, // 60 minutes — builder runs can be long
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
      when: (ctx) => inspectReadyQueue.output(ctx).actionableCount > 0,
      repairLoop: {
        maxRepairAttempts: 3,
        checks: [
          {
            id: "task-queue-valid",
            tool: "shell",
            input: (ctx) => ({
              command: "npm run validate-tasks",
              stream_output: false,
              cwd: ctx.projectDir,
            }),
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
    typedCodeStep<BuilderRunSummary>({
      id: "write-run-summary",
      type: "code",
      when: stepCommitted("commit"),
      run: (ctx) => writeBuilderRunSummary(ctx),
    }),
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
