import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import {
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { workflowCommandOutput } from "#core/workflow/workflow-command.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import {
  assessFailure,
  decomposerTaskResources,
  decompositionTargetTaskId,
  shouldRunDecompose,
  verifyDecomposerTaskContractAfterReconcile,
} from "./assessment.js";
import {
  type AppliedDecomposition,
  applyDecompositionOperation,
} from "./blocking-operations.js";
import {
  decodeDecompositionPlan,
  decodeDecompositionReview,
  decompositionPlanOutputSchema,
  decompositionReviewOutputSchema,
} from "./decomposition-plan.js";

export const agent: AgentDef = {
  name: "decomposer",
  role: "Rescope builder tasks that exhausted execution without progress.",
  promptPath: "src/modules/autonomy/workflows/decomposer/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  writeScope: "deny-all",
};

export type { DecomposerAssessment } from "./assessment.js";

const requireDecompositionApproval = typedCodeStep<{ approved: true }>({
  id: "require-decomposition-approval",
  type: "code",
  when: stepSucceeded("review-decomposition"),
  validate: (raw) =>
    expectStructuredOutput<{ approved: true }>(raw, ["approved"]),
  run: (ctx) => {
    const review = decodeDecompositionReview(
      ctx.stepOutputs["review-decomposition"],
    );
    if (review.decision === "reject") {
      throw new Error(
        `Decomposition semantic review rejected the plan: ${review.issues.join("; ")}`,
      );
    }
    return { approved: true };
  },
});

const writeCommitMessage = typedCodeStep<{ written: true }>({
  id: "write-commit-message",
  type: "code",
  when: stepSucceeded("require-decomposition-approval"),
  validate: (raw) =>
    expectStructuredOutput<{ written: true }>(raw, ["written"]),
  run: async (ctx) => {
    await mkdir(ctx.workflow.runDirPath, { recursive: true });
    await writeFile(
      join(ctx.workflow.runDirPath, "commit-message.txt"),
      `Decompose ${decompositionTargetTaskId(ctx)} after exhausted builder repair\n`,
      "utf-8",
    );
    return { written: true } as const;
  },
});

const applyDecomposition = typedCodeStep<AppliedDecomposition>({
  id: "apply-decomposition",
  type: "code",
  when: stepSucceeded("write-commit-message"),
  validate: (raw) =>
    expectStructuredOutput<AppliedDecomposition>(raw, ["taskId", "subtaskIds"]),
  run: (ctx) => {
    const assessment = assessFailure.outputRequired(ctx);
    if (!assessment.shouldDecompose) {
      throw new Error("Cannot apply decomposition without an active target");
    }
    return ctx.runBlocking(applyDecompositionOperation, {
      projectDir: ctx.projectDir,
      stateDir: ctx.stateDir,
      assessment,
      plan: decodeDecompositionPlan(ctx.stepOutputs.decompose),
    });
  },
});

const validateDecomposition = typedCodeStep<{
  taskQueue: string;
}>({
  id: "validate-decomposition",
  type: "code",
  when: stepSucceeded("apply-decomposition"),
  validate: (raw) =>
    expectStructuredOutput(raw, ["taskQueue"]),
  run: async (ctx) => {
    const taskQueue = workflowCommandOutput(
      await ctx.runCommand({
        command: "pnpm",
        args: ["run", "validate-tasks"],
        cwd: ctx.projectDir,
      }),
    );
    return { taskQueue };
  },
});

const decomposerWorkflow: WorkflowDefinitionInput = {
  name: "decomposer",
  repository: "write",
  integration: {
    validationCommand: ["pnpm", "validate-tasks"],
    postReconcile: verifyDecomposerTaskContractAfterReconcile,
  },
  resources: decomposerTaskResources,
  description: "Rescope builder tasks after timeout or exhausted repair.",
  tags: ["monitored"],
  // Capable-tier presets may resolve to a native CLI harness. Both reasoning
  // agents remain read-only through AgentDef deny-all plus whole-step mutation
  // enforcement, while autonomous is the native harness's enforceable mode.
  defaultAutonomyMode: "autonomous",
  triggers: [
    {
      event: "workflow.completed",
      queueMode: "all",
      filter: {
        workflow: ["builder"],
        status: ["failed"],
      },
    },
  ],
  steps: [
    assessFailure,
    {
      id: "decompose",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: AUTONOMY_AGENT_DEFAULTS.effort,
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
      outputFormat: "json",
      outputSchema: decompositionPlanOutputSchema,
      validate: decodeDecompositionPlan,
      exposeOutputToAgent: true,
      exposedOutputTrust: "untrusted",
      when: shouldRunDecompose,
    },
    {
      id: "review-decomposition",
      type: "agent",
      agentName: agent.name,
      promptPath: "src/modules/autonomy/workflows/decomposer/review-prompt.md",
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: AUTONOMY_AGENT_DEFAULTS.effort,
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
      outputFormat: "json",
      outputSchema: decompositionReviewOutputSchema,
      validate: decodeDecompositionReview,
      when: stepSucceeded("decompose"),
    },
    requireDecompositionApproval,
    writeCommitMessage,
    applyDecomposition,
    validateDecomposition,
  ],
};

export default decomposerWorkflow;
