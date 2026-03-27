import type { WorkflowStepContext } from "../../workflow/run-types.js";
import type { WorkflowDefinitionInput } from "../../workflow/types.js";
import { commitBuilderChanges } from "../builder/commit.js";
import { stepSucceeded } from "../shared.js";
import { recoverDoingTasks } from "./recover-doing-tasks.js";

const VERIFY_STEP_IDS = [
  "verify-typecheck",
  "verify-lint",
  "verify-test",
  "verify-build",
] as const;

function allVerifyStepsPassed({ stepResults }: WorkflowStepContext): boolean {
  return VERIFY_STEP_IDS.every((id) => stepResults[id]?.status === "success");
}

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
      id: "recover-doing-tasks",
      type: "code",
      run: (ctx) => recoverDoingTasks(ctx),
    },
    {
      // Fail fast if lint is already broken before the agent spends budget.
      id: "preflight-lint",
      type: "tool",
      tool: "shell",
      input: (ctx) => ({ command: "npm run lint", stream_output: false, cwd: ctx.projectDir }),
    },
    {
      // Fail fast if the test baseline is already broken before the agent spends budget.
      id: "preflight-test",
      type: "tool",
      tool: "shell",
      when: stepSucceeded("preflight-lint"),
      input: (ctx) => ({ command: "npm test", stream_output: false, timeout_ms: 300_000, cwd: ctx.projectDir }),
      retry: { maxAttempts: 3, initialDelayMs: 30_000, backoffFactor: 1 },
    },
    {
      id: "improve",
      type: "agent",
      agentName: "improver",
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
      when: (ctx) => stepSucceeded("preflight-lint")(ctx) && stepSucceeded("preflight-test")(ctx),
    },
    {
      id: "verify-typecheck",
      type: "tool",
      tool: "shell",
      when: stepSucceeded("improve"),
      input: { command: "npm run typecheck", stream_output: false },
    },
    {
      id: "verify-lint",
      type: "tool",
      tool: "shell",
      when: stepSucceeded("improve"),
      input: { command: "npm run lint", stream_output: false },
    },
    {
      id: "verify-test",
      type: "tool",
      tool: "shell",
      when: stepSucceeded("improve"),
      input: { command: "npm test", stream_output: false, timeout_ms: 300_000 },
    },
    {
      id: "verify-build",
      type: "tool",
      tool: "shell",
      when: stepSucceeded("improve"),
      input: { command: "npm run build", stream_output: false },
    },
    {
      id: "commit",
      type: "code",
      when: allVerifyStepsPassed,
      run: ({ projectDir, workflow }: WorkflowStepContext) =>
        commitBuilderChanges(projectDir, workflow.runDirPath),
    },
    {
      id: "request-restart",
      type: "restart",
      when: stepSucceeded("improve"),
      reason: "improver workflow finished verification build",
      requires: [...VERIFY_STEP_IDS],
    },
  ],
};

export default improverWorkflow;
