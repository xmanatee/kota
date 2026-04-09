import type { WorkflowStepContext } from "../../workflow/run-types.js";
import type { WorkflowDefinitionInput } from "../../workflow/types.js";
import { commitWorkflowChanges } from "../commit.js";
import { runCheck, stepCommitted, stepSucceeded } from "../shared.js";

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
      timeoutMs: 60 * 60 * 1000, // 60 minutes — improver analysis can be thorough
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
      repairLoop: {
        maxRepairAttempts: 3,
        checks: [
          {
            id: "build-output",
            type: "code" as const,
            run: (ctx: WorkflowStepContext) => runCheck("pnpm build", ctx.projectDir),
          },
          {
            id: "task-queue-valid",
            type: "code" as const,
            run: (ctx: WorkflowStepContext) => runCheck("pnpm run validate-tasks", ctx.projectDir),
          },
          {
            id: "typecheck",
            type: "code" as const,
            run: (ctx: WorkflowStepContext) => runCheck("pnpm run typecheck", ctx.projectDir),
          },
          {
            id: "lint",
            type: "code" as const,
            run: (ctx: WorkflowStepContext) => runCheck("pnpm run lint", ctx.projectDir),
          },
          {
            id: "test",
            type: "code" as const,
            run: (ctx: WorkflowStepContext) => runCheck("pnpm test", ctx.projectDir, 300_000),
          },
        ],
      },
    },
    {
      id: "commit",
      type: "code",
      when: stepSucceeded("improve"),
      run: ({ projectDir, workflow }: WorkflowStepContext) =>
        commitWorkflowChanges(projectDir, workflow.runDirPath),
    },
    {
      id: "request-restart",
      type: "restart",
      when: stepCommitted("commit"),
      reason: "improver workflow finished validation and commit",
      requires: ["commit"],
    },
  ],
};

export default improverWorkflow;
