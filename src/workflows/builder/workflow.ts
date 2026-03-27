import {
  getRepoTaskQueueSnapshot,
  isRepoTaskQueueSnapshot,
} from "../../repo-tasks.js";
import type { WorkflowDefinitionInput, WorkflowStepContext } from "../../workflow/types.js";
import { stepSucceeded } from "../shared.js";
import { checkTaskOutcome } from "./check-task-outcome.js";
import { claimTask, isClaimTaskResult } from "./claim-task.js";
import { commitBuilderChanges } from "./commit.js";
import { gatherBuilderContext } from "./gather-context.js";
import { isBuilderPreflightResult, runBuilderPreflight } from "./preflight.js";
import { verifyClaim } from "./verify-claim.js";

const VERIFY_STEP_IDS = [
  "verify-typecheck",
  "verify-lint",
  "verify-test",
  "verify-build",
] as const;

function allVerifyStepsPassed({ stepResults }: WorkflowStepContext): boolean {
  return VERIFY_STEP_IDS.every((id) => stepResults[id]?.status === "success");
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
      run: ({ projectDir }) => getRepoTaskQueueSnapshot(projectDir),
    },
    {
      id: "preflight",
      type: "code",
      when: ({ previousOutput }) =>
        isRepoTaskQueueSnapshot(previousOutput) &&
        previousOutput.counts.ready > 0,
      run: ({ projectDir }) => runBuilderPreflight(projectDir),
    },
    {
      id: "gather-context",
      type: "code",
      when: ({ previousOutput }) =>
        isBuilderPreflightResult(previousOutput) &&
        previousOutput.validCount > 0,
      run: (ctx) => gatherBuilderContext(ctx),
    },
    {
      id: "claim-task",
      type: "code",
      when: ({ stepOutputs }) =>
        isBuilderPreflightResult(stepOutputs.preflight) &&
        (stepOutputs.preflight as { validCount: number }).validCount > 0,
      run: ({ projectDir }) => claimTask(projectDir),
    },
    {
      id: "verify-claim",
      type: "code",
      when: ({ stepOutputs }) => isClaimTaskResult(stepOutputs["claim-task"]),
      run: ({ projectDir, stepOutputs }) => {
        const claim = stepOutputs["claim-task"] as { chosenTaskId: string };
        return verifyClaim(projectDir, claim.chosenTaskId);
      },
    },
    {
      // Fail fast if lint is already broken before the agent spends budget.
      id: "preflight-lint",
      type: "tool",
      tool: "shell",
      when: ({ stepOutputs }) => isClaimTaskResult(stepOutputs["claim-task"]),
      input: { command: "npm run lint", stream_output: false },
    },
    {
      id: "build",
      type: "agent",
      agentName: "builder",
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
      when: (ctx) =>
        isClaimTaskResult(ctx.stepOutputs["claim-task"]) && stepSucceeded("preflight-lint")(ctx),
    },
    {
      id: "check-task-outcome",
      type: "code",
      continueOnFailure: true,
      when: ({ stepOutputs }) => isClaimTaskResult(stepOutputs["claim-task"]),
      run: ({ projectDir, stepOutputs }) => {
        const claim = stepOutputs["claim-task"] as { chosenTaskId: string };
        return checkTaskOutcome(projectDir, claim.chosenTaskId);
      },
    },
    {
      id: "verify-typecheck",
      type: "tool",
      tool: "shell",
      when: stepSucceeded("build"),
      input: { command: "npm run typecheck", stream_output: false },
    },
    {
      id: "verify-lint",
      type: "tool",
      tool: "shell",
      when: stepSucceeded("build"),
      input: { command: "npm run lint", stream_output: false },
    },
    {
      id: "verify-test",
      type: "tool",
      tool: "shell",
      when: stepSucceeded("build"),
      input: { command: "npm test", stream_output: false, timeout_ms: 300_000 },
      retry: { maxAttempts: 2, initialDelayMs: 10_000, backoffFactor: 1 },
    },
    {
      id: "verify-build",
      type: "tool",
      tool: "shell",
      when: stepSucceeded("build"),
      input: { command: "npm run build", stream_output: false },
    },
    {
      // Structural gate: commits staged changes only when all verification steps pass.
      // The agent stages changes but does not commit; this step is the sole commit point.
      id: "commit",
      type: "code",
      when: allVerifyStepsPassed,
      run: ({ projectDir, workflow }) => commitBuilderChanges(projectDir, workflow.runDirPath),
    },
    {
      id: "request-restart",
      type: "restart",
      when: stepSucceeded("build"),
      reason: "builder workflow finished verification build",
      requires: [...VERIFY_STEP_IDS],
    },
  ],
};

export default builderWorkflow;
