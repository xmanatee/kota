import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { labeledPredicate, type WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  type BuilderDecompositionFailureKind,
  classifyBuilderFailureForDecomposition,
} from "#modules/autonomy/builder-failure-classification.js";
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

export type DecomposerAssessment = {
  reason: string;
  failedRunId: string;
  failedRunDir: string;
  failureKind: BuilderDecompositionFailureKind | null;
} & (
  | { shouldDecompose: false }
  | {
      shouldDecompose: true;
      taskId: string;
      taskPath: string;
      taskMarkdown: string;
    }
);

const TASK_STATES_FOR_IDENTIFIED_TASK = ["doing", "blocked", "ready"] as const;

function findTaskById(
  projectDir: string,
  taskId: string,
): { id: string; path: string } | null {
  for (const state of TASK_STATES_FOR_IDENTIFIED_TASK) {
    const candidate = join(projectDir, "data", "tasks", state, `${taskId}.md`);
    if (existsSync(candidate)) {
      return { id: taskId, path: join("data", "tasks", state, `${taskId}.md`) };
    }
  }
  return null;
}

type ResolvedSource = {
  runId: string;
  runDir: string;
  /** True when the trigger gives us no usable source context (non-builder recovery). */
  skip: boolean;
};

function resolveSourceRun(
  triggerEvent: string,
  payload: Record<string, unknown>,
): ResolvedSource {
  if (triggerEvent === "runtime.recovered") {
    const sourceWorkflow = payload.sourceWorkflow;
    if (sourceWorkflow !== "builder") {
      return { runId: "", runDir: "", skip: true };
    }
    const sourceRunId = payload.sourceRunId;
    if (typeof sourceRunId !== "string" || sourceRunId.length === 0) {
      throw new Error(
        "Decomposer recovery trigger payload must include sourceRunId when sourceWorkflow is builder",
      );
    }
    return {
      runId: sourceRunId,
      runDir: join(".kota", "runs", sourceRunId),
      skip: false,
    };
  }

  const runDir = payload.runDir;
  const runId = payload.runId;
  if (typeof runDir !== "string" || typeof runId !== "string") {
    throw new Error("Decomposer trigger payload must include runDir and runId");
  }
  return { runId, runDir, skip: false };
}

type BuilderTaskClaimArtifact = {
  claimed?: boolean;
  taskId?: string | null;
};

function readClaimedTaskId(projectDir: string, runDir: string): string | null {
  const artifact = readOptionalJsonFile<BuilderTaskClaimArtifact>(
    join(projectDir, runDir, "task-claim.json"),
  );
  return artifact?.claimed === true && typeof artifact.taskId === "string"
    ? artifact.taskId
    : null;
}

function buildAssessment(
  projectDir: string,
  triggerEvent: string,
  triggerPayload: Record<string, unknown>,
): DecomposerAssessment {
  const source = resolveSourceRun(triggerEvent, triggerPayload);

  if (source.skip) {
    return {
      shouldDecompose: false,
      reason: "Recovery source was not builder — nothing for decomposer to do",
      failedRunId: "",
      failedRunDir: "",
      failureKind: null,
    };
  }

  const metadataPath = join(projectDir, source.runDir, "metadata.json");
  const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);

  if (!metadata) {
    return {
      shouldDecompose: false,
      reason: `Could not read run metadata at ${metadataPath}`,
      failedRunId: source.runId,
      failedRunDir: source.runDir,
      failureKind: null,
    };
  }

  const failureKind = classifyBuilderFailureForDecomposition(metadata);
  if (failureKind === null) {
    return {
      shouldDecompose: false,
      reason: "Builder failure does not require task rescoping",
      failedRunId: source.runId,
      failedRunDir: source.runDir,
      failureKind: null,
    };
  }

  const candidateId = readClaimedTaskId(projectDir, source.runDir);
  const task = candidateId ? findTaskById(projectDir, candidateId) : null;

  if (!task) {
    return {
      shouldDecompose: false,
      reason: candidateId
        ? `Builder task ${candidateId} is no longer active; its current task state supersedes this failure`
        : "Builder run has no claimed task artifact to rescope",
      failedRunId: source.runId,
      failedRunDir: source.runDir,
      failureKind,
    };
  }

  return {
    shouldDecompose: true,
    reason: `Builder ${failureKind === "timeout" ? "timed out" : "exhausted repair"} on ${task.id} — rescoping`,
    failedRunId: source.runId,
    failedRunDir: source.runDir,
    taskId: task.id,
    taskPath: task.path,
    taskMarkdown: readFileSync(join(projectDir, task.path), "utf-8"),
    failureKind,
  };
}

const assessFailure = typedCodeStep<DecomposerAssessment>({
  id: "assess-failure",
  type: "code",
  exposeOutputToAgent: true,
  validate: (raw) =>
    expectStructuredOutput<DecomposerAssessment>(raw, [
      "reason",
      "failedRunId",
      "failedRunDir",
      "failureKind",
      "shouldDecompose",
    ]),
  run: ({ projectDir, trigger }) =>
    buildAssessment(projectDir, trigger.event, trigger.payload),
});

const shouldRunDecompose = labeledPredicate(
  "no-decompose-target",
  (ctx) => assessFailure.outputRequired(ctx).shouldDecompose,
);

function decompositionTargetTaskId(ctx: Parameters<typeof assessFailure.outputRequired>[0]): string {
  const assessment = assessFailure.outputRequired(ctx);
  if (assessment.shouldDecompose) return assessment.taskId;
  throw new Error("decompose step ran without an active task target");
}

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
  defaultAutonomyMode: "passive",
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
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
      outputFormat: "json",
      outputSchema: decompositionPlanOutputSchema,
      validate: decodeDecompositionPlan,
      exposeOutputToAgent: true,
      when: shouldRunDecompose,
    },
    {
      id: "review-decomposition",
      type: "agent",
      agentName: agent.name,
      promptPath: "src/modules/autonomy/workflows/decomposer/review-prompt.md",
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
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
