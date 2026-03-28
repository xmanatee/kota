import { assertTaskQueueValid } from "../../task-queue-validation.js";
import type { WorkflowStepContext } from "../../workflow/run-types.js";
import type { WorkflowDefinitionInput } from "../../workflow/types.js";
import { commitBuilderChanges } from "../builder/commit.js";
import { stepSucceeded } from "../shared.js";

const improverWorkflow: WorkflowDefinitionInput = {
  name: "improver",
  description:
    "Improve the autonomous development system itself using evidence from recent runs.",
  triggers: [
    {
      event: "workflow.completed",
      filter: {
        workflow: "builder",
        status: ["success", "failed", "interrupted"],
      },
    },
    {
      event: "workflow.completed",
      filter: {
        workflow: "explorer",
        status: "failed",
      },
    },
  ],
  steps: [
    {
      id: "improve",
      type: "agent",
      agentName: "improver",
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
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
            input: (ctx) => ({ command: "npm run typecheck", stream_output: false, cwd: ctx.projectDir }),
          },
          {
            id: "lint",
            tool: "shell",
            input: (ctx) => ({ command: "npm run lint", stream_output: false, cwd: ctx.projectDir }),
          },
          {
            id: "test",
            tool: "shell",
            input: (ctx) => ({ command: "npm test", stream_output: false, timeout_ms: 300_000, cwd: ctx.projectDir }),
          },
          {
            id: "build-output",
            tool: "shell",
            input: (ctx) => ({ command: "npm run build", stream_output: false, cwd: ctx.projectDir }),
          },
        ],
      },
    },
    {
      id: "commit",
      type: "code",
      when: stepSucceeded("improve"),
      run: ({ projectDir, workflow }: WorkflowStepContext) =>
        commitBuilderChanges(projectDir, workflow.runDirPath),
    },
    {
      id: "request-restart",
      type: "restart",
      when: stepSucceeded("commit"),
      reason: "improver workflow finished validation and commit",
      requires: ["commit"],
    },
  ],
};

export default improverWorkflow;
