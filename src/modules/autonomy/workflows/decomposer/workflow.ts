import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import type { WorkflowCommitPathPolicy } from "#modules/autonomy/commit.js";
import {
  onRecoveryTrigger,
  resetWorktreeForRecoveryOperation,
} from "#modules/autonomy/recovery.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
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
  workflowCommitOperation,
  workflowCommitValidationOperation,
} from "#modules/autonomy/workflow-commit-operations.js";
import {
  assertDecompositionOwnership,
  assessFailure,
  type DecomposerAssessment,
  decompositionTargetTaskId,
  shouldRunDecompose,
} from "./assessment.js";
import {
  type AppliedDecomposition,
  applyDecompositionPlan,
} from "./decomposition-actions.js";
import {
  type DecompositionPlan,
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

type ApplyDecompositionInput = {
  projectDir: string;
  assessment: Extract<DecomposerAssessment, { shouldDecompose: true }>;
  plan: DecompositionPlan;
};

export function applyOwnedDecompositionInWorker(
  input: ApplyDecompositionInput,
): AppliedDecomposition {
  assertDecompositionOwnership(input.projectDir, input.assessment);
  return applyDecompositionPlan({
    projectDir: input.projectDir,
    taskId: input.assessment.taskId,
    failedRunId: input.assessment.failedRunId,
    plan: input.plan,
  });
}

const applyOwnedDecompositionOperation = defineWorkflowBlockingOperation<
  ApplyDecompositionInput,
  AppliedDecomposition
>(import.meta.url, "applyOwnedDecompositionInWorker");

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
    return ctx.runBlocking(applyOwnedDecompositionOperation, {
      projectDir: ctx.projectDir,
      assessment,
      plan: decodeDecompositionPlan(ctx.stepOutputs.decompose),
    });
  },
});

function decompositionCommitPathPolicy(
  ctx: Parameters<typeof assessFailure.outputRequired>[0],
): WorkflowCommitPathPolicy {
  const assessment = assessFailure.outputRequired(ctx);
  if (!assessment.shouldDecompose) {
    throw new Error(
      "Cannot build a decomposition commit policy without an active task",
    );
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
  run: async (ctx) => {
    const taskQueue = await runCheck(
      "pnpm run validate-tasks",
      ctx.projectDir,
      { signal: ctx.signal },
    );
    const validation = await ctx.runBlocking(
      workflowCommitValidationOperation,
      {
        projectDir: ctx.projectDir,
        runDirPath: ctx.workflow.runDirPath,
        policy: decompositionCommitPathPolicy(ctx),
      },
    );
    return { taskQueue, ...validation };
  },
});

type FinalizedSourceClaim = {
  changed: boolean;
  recoveryStatus: string;
};

type FinalizeSourceClaimInput = {
  projectDir: string;
  taskId: string;
  failedRunId: string;
  workflowRunId: string;
};

export function finalizeOwnedSourceClaimInWorker(
  input: FinalizeSourceClaimInput,
): FinalizedSourceClaim {
  const claim = readActiveTaskClaim(input.projectDir, input.taskId);
  if (
    claim === null ||
    claim.status !== "pending-decomposition" ||
    claim.workflowId !== "builder" ||
    claim.runId !== input.failedRunId
  ) {
    throw new Error(
      `Cannot finalize claim for ${input.taskId}: expected builder/${input.failedRunId}/pending-decomposition ownership`,
    );
  }
  const result = supersedeTaskClaim({
    projectDir: input.projectDir,
    taskId: input.taskId,
    runId: input.failedRunId,
    workflowId: "builder",
    evidence:
      `decomposer ${input.workflowRunId} replaced the exhausted task with bounded subtasks`,
  });
  if (!result.changed) {
    throw new Error(
      `Cannot finalize claim for ${input.taskId}: ${result.reason ?? "claim ownership changed"}`,
    );
  }
  return {
    changed: result.changed,
    recoveryStatus: result.recoveryStatus,
  };
}

const finalizeOwnedSourceClaimOperation = defineWorkflowBlockingOperation<
  FinalizeSourceClaimInput,
  FinalizedSourceClaim
>(import.meta.url, "finalizeOwnedSourceClaimInWorker");

const finalizeSourceClaim = typedCodeStep<FinalizedSourceClaim>({
  id: "finalize-source-claim",
  type: "code",
  when: stepCommitted("commit"),
  validate: (raw) =>
    expectStructuredOutput<FinalizedSourceClaim>(raw, [
      "changed",
      "recoveryStatus",
    ]),
  run: (ctx) => {
    const assessment = assessFailure.outputRequired(ctx);
    if (!assessment.shouldDecompose) {
      throw new Error(
        "Cannot finalize a source claim without a decomposition target",
      );
    }
    return ctx.runBlocking(finalizeOwnedSourceClaimOperation, {
      projectDir: ctx.projectDir,
      taskId: assessment.taskId,
      failedRunId: assessment.failedRunId,
      workflowRunId: ctx.workflow.runId,
    });
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
      run: (ctx) =>
        ctx.runBlocking(resetWorktreeForRecoveryOperation, {
          projectDir: ctx.projectDir,
          workflowName: "decomposer",
        }),
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
        ctx.runBlocking(workflowCommitOperation, {
          projectDir: ctx.projectDir,
          runDirPath: ctx.workflow.runDirPath,
          policy: decompositionCommitPathPolicy(ctx),
        }),
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
