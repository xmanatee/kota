import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  checkCommitStageable,
  commitWorkflowChanges,
  type WorkflowCommitPathPolicy,
} from "#modules/autonomy/commit.js";
import {
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  checkCommitMessageExists,
  checkNoScratchArtifacts,
  runCheck,
  stepCommitRequiresDaemonRestart,
  stepCommitted,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import {
  readActiveTaskClaim,
  supersedeTaskClaim,
} from "#modules/autonomy/task-claims.js";
import {
  assessFailure,
  decompositionTargetTaskId,
  shouldRunDecompose,
} from "./assessment.js";
import {
  type AppliedDecomposition,
  applyDecompositionPlan,
} from "./decomposition-actions.js";
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
  validate: (raw) => expectStructuredOutput<{ approved: true }>(raw, ["approved"]),
  run: (ctx) => {
    const review = decodeDecompositionReview(ctx.stepOutputs["review-decomposition"]);
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
  validate: (raw) => expectStructuredOutput<{ written: true }>(raw, ["written"]),
  run: (ctx) => {
    writeFileSync(
      join(ctx.workflow.runDirPath, "commit-message.txt"),
      `Decompose ${decompositionTargetTaskId(ctx)} after exhausted builder repair\n`,
      "utf-8",
    );
    return { written: true };
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
    return applyDecompositionPlan({
      projectDir: ctx.projectDir,
      taskId: decompositionTargetTaskId(ctx),
      failedRunId: assessment.failedRunId,
      plan: decodeDecompositionPlan(ctx.stepOutputs.decompose),
    });
  },
});

function decompositionCommitPathPolicy(
  ctx: Parameters<typeof assessFailure.outputRequired>[0],
): WorkflowCommitPathPolicy {
  const assessment = assessFailure.outputRequired(ctx);
  if (!assessment.shouldDecompose) {
    throw new Error("Cannot build a decomposition commit policy without an active task");
  }
  const applied = applyDecomposition.outputRequired(ctx);
  return {
    kind: "exact-paths",
    paths: [
      assessment.taskPath,
      `data/tasks/dropped/${assessment.taskId}.md`,
      ...applied.subtaskIds.map((id) => `data/tasks/ready/${id}.md`),
    ],
  };
}

const validateDecomposition = typedCodeStep<{
  taskQueue: string;
  scratchArtifacts: string;
  commitMessage: string;
  commitStage: string;
}>({
  id: "validate-decomposition",
  type: "code",
  when: stepSucceeded("apply-decomposition"),
  validate: (raw) =>
    expectStructuredOutput(raw, [
      "taskQueue",
      "scratchArtifacts",
      "commitMessage",
      "commitStage",
    ]),
  run: async (ctx) => ({
    taskQueue: await runCheck("pnpm run validate-tasks", ctx.projectDir, {
      signal: ctx.signal,
    }),
    scratchArtifacts: checkNoScratchArtifacts(ctx.projectDir),
    commitMessage: checkCommitMessageExists(
      ctx.workflow.runDirPath,
      ctx.projectDir,
    ),
    commitStage: checkCommitStageable(
      ctx.projectDir,
      decompositionCommitPathPolicy(ctx),
    ),
  }),
});

const finalizeSourceClaim = typedCodeStep<{
  changed: boolean;
  recoveryStatus: string;
}>({
  id: "finalize-source-claim",
  type: "code",
  when: stepCommitted("commit"),
  validate: (raw) =>
    expectStructuredOutput(raw, ["changed", "recoveryStatus"]),
  run: (ctx) => {
    const assessment = assessFailure.outputRequired(ctx);
    if (!assessment.shouldDecompose) {
      throw new Error("Cannot finalize a source claim without a decomposition target");
    }
    const claim = readActiveTaskClaim(ctx.projectDir, assessment.taskId);
    if (
      claim !== null &&
      (claim.status !== "pending-decomposition" || claim.workflowId !== "builder")
    ) {
      throw new Error(
        `Cannot finalize claim for ${assessment.taskId}: claim is ${claim.workflowId}/${claim.status}`,
      );
    }
    const result = supersedeTaskClaim({
      projectDir: ctx.projectDir,
      taskId: assessment.taskId,
      runId: claim?.runId ?? assessment.failedRunId,
      workflowId: claim?.workflowId ?? "builder",
      evidence: `decomposer ${ctx.workflow.runId} replaced the exhausted task with bounded subtasks`,
    });
    if (!result.changed && result.claim !== null) {
      throw new Error(
        `Cannot finalize claim for ${assessment.taskId}: ${result.reason ?? "claim ownership changed"}`,
      );
    }
    return {
      changed: result.changed,
      recoveryStatus: result.recoveryStatus,
    };
  },
});

const decomposerWorkflow: WorkflowDefinitionInput = {
  name: "decomposer",
  description: "Rescope builder tasks after timeout or exhausted repair.",
  tags: ["monitored"],
  recoveryCapable: true,
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
    {
      event: "runtime.recovered",
      queueMode: "all",
    },
  ],
  steps: [
    {
      id: "reset-for-recovery",
      type: "code",
      when: onRecoveryTrigger,
      run: ({ projectDir }) =>
        resetWorktreeForRecovery({ projectDir, workflowName: "decomposer" }),
    },
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
    {
      id: "commit",
      type: "code",
      when: stepSucceeded("validate-decomposition"),
      run: (ctx) =>
        commitWorkflowChanges(
          ctx.projectDir,
          ctx.workflow.runDirPath,
          decompositionCommitPathPolicy(ctx),
        ),
    },
    finalizeSourceClaim,
    {
      id: "request-restart",
      type: "restart",
      when: (ctx) =>
        stepSucceeded("finalize-source-claim")(ctx) &&
        stepCommitRequiresDaemonRestart("commit")(ctx),
      reason: "decomposer committed new subtasks to ready queue",
      requires: ["finalize-source-claim"],
    },
  ],
};

export default decomposerWorkflow;
