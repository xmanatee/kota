import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { askOwnerSteps } from "#core/workflow/ask-owner-step.js";
import {
  isWorkflowRepairErrorKind,
  isWorkflowStepTimeoutErrorKind,
  labeledPredicate,
  type WorkflowRunMetadata,
} from "#core/workflow/run-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { checkCommitStageable, commitWorkflowChanges } from "#modules/autonomy/commit.js";
import {
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  AUTONOMY_AGENT_HARNESS,
  AUTONOMY_DISALLOWED_TOOLS,
  checkCommitMessageExists,
  checkNoScratchArtifacts,
  runCheck,
  stepCommitted,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import { checkDecompositionApplied } from "./decomposition-check.js";

export const agent: AgentDef = {
  name: "decomposer",
  role: "Rescope builder tasks that exhausted execution without progress.",
  promptPath: "src/modules/autonomy/workflows/decomposer/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  writeScope: ["data/tasks/"],
};

/**
 * Operator-only ambiguities the agent loop cannot resolve from repo state
 * alone. When set on the assessment, the workflow opens an `askOwnerSteps`
 * recipe instead of silently skipping the run.
 */
export type DecomposerEscalation = {
  kind: "task-not-found";
  /**
   * Task id recorded by the failed builder. The task is no longer in any
   * active state, so the operator is the only one who knows whether it should
   * be decomposed anyway or whether the trigger should be dropped.
   */
  candidateTaskId: string;
};

type DecomposerFailureKind = "timeout" | "repair-exhausted";

export type DecomposerAssessment = {
  reason: string;
  failedRunId: string;
  failedRunDir: string;
  failureKind: DecomposerFailureKind | null;
  escalation: DecomposerEscalation | null;
} & (
  | { shouldDecompose: false }
  | { shouldDecompose: true; taskId: string; taskPath: string }
);

/**
 * Outcome of the operator-loop step that resolves a `DecomposerEscalation`.
 * Mirrors the four `AwaitedOwnerOutcome` kinds explicitly: `answered`
 * collapses to either `approved` (when the operator authorized continuing)
 * or `skipped` (any other answer); `dismissed`, `expired`, and `timeout` all
 * fall back to `skipped` with a human-readable reason. `no-escalation` is
 * the trivial path when the assessment did not need operator input.
 */
export type EscalationResolution =
  | { kind: "no-escalation" }
  | {
      kind: "approved";
      taskId: string;
      operatorAnswer: string;
      /** Pre-rendered injection-defense banner; null when the answer was clean. */
      banner: string | null;
    }
  | { kind: "skipped"; reason: string };

const DECOMPOSE_PREFIX = "decompose ";

function parseOperatorApproval(
  answer: string,
  candidateTaskId: string,
): { approved: boolean; resolvedTaskId: string } {
  const normalized = answer.trim().toLowerCase();
  if (!normalized.startsWith(DECOMPOSE_PREFIX)) {
    return { approved: false, resolvedTaskId: candidateTaskId };
  }
  const namedId = normalized.slice(DECOMPOSE_PREFIX.length).trim();
  return {
    approved: namedId === candidateTaskId.toLowerCase(),
    resolvedTaskId: namedId,
  };
}

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

function classifyBuilderFailure(metadata: WorkflowRunMetadata): DecomposerFailureKind | null {
  const buildStep = metadata.steps.find((s) => s.id === "build");
  if (!buildStep || buildStep.status !== "failed") return null;

  if (isWorkflowStepTimeoutErrorKind(buildStep.errorKind)) {
    return "timeout";
  }
  if (isWorkflowRepairErrorKind(buildStep.errorKind)) {
    return "repair-exhausted";
  }

  return null;
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
      escalation: null,
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
      escalation: null,
    };
  }

  const failureKind = classifyBuilderFailure(metadata);
  if (failureKind === null) {
    return {
      shouldDecompose: false,
      reason: "Builder failure does not require task rescoping",
      failedRunId: source.runId,
      failedRunDir: source.runDir,
      failureKind: null,
      escalation: null,
    };
  }

  const candidateId = readClaimedTaskId(projectDir, source.runDir);
  const task = candidateId ? findTaskById(projectDir, candidateId) : null;

  if (!task) {
    const escalation: DecomposerEscalation | null = candidateId
      ? { kind: "task-not-found", candidateTaskId: candidateId }
      : null;
    return {
      shouldDecompose: false,
      reason: candidateId
        ? `Builder task ${candidateId} is no longer in an active task state`
        : "Builder run has no claimed task artifact to rescope",
      failedRunId: source.runId,
      failedRunDir: source.runDir,
      failureKind,
      escalation,
    };
  }

  return {
    shouldDecompose: true,
    reason: `Builder ${failureKind === "timeout" ? "timed out" : "exhausted repair"} on ${task.id} — rescoping`,
    failedRunId: source.runId,
    failedRunDir: source.runDir,
    taskId: task.id,
    taskPath: task.path,
    failureKind,
    escalation: null,
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
      "escalation",
      "shouldDecompose",
    ]),
  run: ({ projectDir, trigger }) =>
    buildAssessment(projectDir, trigger.event, trigger.payload),
});

const escalationGate = labeledPredicate(
  "no-escalation-needed",
  (ctx) => assessFailure.outputRequired(ctx).escalation !== null,
);

const escalationSteps = askOwnerSteps({
  idPrefix: "escalate-task-not-found",
  // 15 minutes — short enough that an unreachable operator does not block the
  // queue, long enough that a human checking notifications has a fair window.
  awaitTimeoutMs: 15 * 60 * 1000,
  input: (ctx) => {
    const a = assessFailure.outputRequired(ctx);
    if (!a.escalation) {
      throw new Error(
        "decomposer escalation: ask step ran without an escalation on the assessment — gate predicate is broken",
      );
    }
    const candidate = a.escalation.candidateTaskId;
    return {
      context:
        `Decomposer assessing builder run ${a.failedRunId}. The failure was ` +
        `${a.failureKind}, but the candidate task "${candidate}" recorded by ` +
        "the failed builder is no longer in any active state " +
        "(doing/, blocked/, ready/). It may have been moved to done/ or dropped/ " +
        "after the failure but before recovery dispatch.",
      question:
        `Should we decompose "${candidate}" anyway, or drop this trigger?`,
      reason:
        "Only the operator knows whether the task was intentionally moved out of " +
        "the active queue. Decomposing a task the operator already resolved would " +
        "create stale subtasks; dropping a task with a real execution failure " +
        "reason loses the failure signal.",
      proposedAnswers: [`decompose ${candidate}`, "drop trigger"],
      source: "decomposer",
      taskId: candidate,
    };
  },
});

const escalateAsk = { ...escalationSteps.ask, when: escalationGate };
const escalateWait = { ...escalationSteps.wait, when: escalationGate };
const escalateConsume = { ...escalationSteps.consume, when: escalationGate };

const applyEscalationOutcome = typedCodeStep<EscalationResolution>({
  id: "apply-escalation-outcome",
  type: "code",
  exposeOutputToAgent: true,
  validate: (raw): EscalationResolution => {
    const obj = expectStructuredOutput<{ kind: EscalationResolution["kind"] }>(raw, ["kind"]);
    const validKinds = ["no-escalation", "approved", "skipped"] as const;
    if (!validKinds.includes(obj.kind)) {
      throw new Error(`unknown EscalationResolution kind "${String(obj.kind)}"`);
    }
    return raw as EscalationResolution;
  },
  run: (ctx): EscalationResolution => {
    const assessment = assessFailure.outputRequired(ctx);
    if (!assessment.escalation) {
      return { kind: "no-escalation" };
    }
    const outcome = escalationSteps.consume.outputRequired(ctx);
    const candidate = assessment.escalation.candidateTaskId;
    switch (outcome.kind) {
      case "answered": {
        const { approved, resolvedTaskId } = parseOperatorApproval(
          outcome.answer,
          candidate,
        );
        if (!approved) {
          return {
            kind: "skipped",
            reason: `operator answered "${outcome.answer}" — not the recognized "decompose ${candidate}" approval`,
          };
        }
        return {
          kind: "approved",
          taskId: resolvedTaskId,
          operatorAnswer: outcome.answer,
          banner: outcome.banner,
        };
      }
      case "dismissed":
        return {
          kind: "skipped",
          reason: `operator dismissed the question${outcome.reason ? `: ${outcome.reason}` : ""}`,
        };
      case "expired":
        return {
          kind: "skipped",
          reason: `question expired with default resolution "${outcome.defaultResolution}"`,
        };
      case "timeout":
        return {
          kind: "skipped",
          reason: `await deadline (${outcome.awaitTimeoutMs}ms) elapsed without an operator answer`,
        };
      default: {
        const _exhaustive: never = outcome;
        return _exhaustive;
      }
    }
  },
});

const shouldRunDecompose = labeledPredicate(
  "no-decompose-target",
  (ctx) => {
    if (assessFailure.outputRequired(ctx).shouldDecompose) return true;
    return applyEscalationOutcome.outputRequired(ctx).kind === "approved";
  },
);

function decompositionTargetTaskId(ctx: Parameters<typeof assessFailure.outputRequired>[0]): string {
  const assessment = assessFailure.outputRequired(ctx);
  if (assessment.shouldDecompose) return assessment.taskId;
  const escalation = applyEscalationOutcome.outputRequired(ctx);
  if (escalation.kind === "approved") return escalation.taskId;
  throw new Error("decompose step ran without an approved task target");
}

const decomposerWorkflow: WorkflowDefinitionInput = {
  name: "decomposer",
  description: "Rescope builder tasks after timeout or exhausted repair.",
  tags: ["monitored"],
  recoveryCapable: true,
  defaultAutonomyMode: "autonomous",
  triggers: [
    {
      event: "workflow.completed",
      filter: {
        workflow: ["builder"],
        status: ["failed"],
      },
    },
    {
      event: "runtime.recovered",
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
    escalateAsk,
    escalateWait,
    escalateConsume,
    applyEscalationOutcome,
    {
      id: "decompose",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      harness: AUTONOMY_AGENT_HARNESS,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: agent.effort,
      disallowedTools: AUTONOMY_DISALLOWED_TOOLS,
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
      when: shouldRunDecompose,
      repairLoop: {
        checks: [
          {
            id: "decomposition-applied",
            type: "code" as const,
            run: (ctx) =>
              checkDecompositionApplied(
                ctx.projectDir,
                decompositionTargetTaskId(ctx),
              ),
          },
          {
            id: "task-queue-valid",
            type: "code" as const,
            run: (ctx) =>
              runCheck("pnpm run validate-tasks", ctx.projectDir, {
                signal: ctx.signal,
              }),
          },
          {
            id: "no-scratch-artifacts",
            type: "code" as const,
            run: (ctx) => checkNoScratchArtifacts(ctx.projectDir),
          },
          {
            id: "commit-message-exists",
            type: "code" as const,
            run: (ctx) => checkCommitMessageExists(ctx.workflow.runDirPath, ctx.projectDir),
          },
          {
            id: "commit-stageable",
            type: "code" as const,
            run: (ctx) => checkCommitStageable(ctx.projectDir),
          },
        ],
      },
    },
    {
      id: "commit",
      type: "code",
      when: stepSucceeded("decompose"),
      run: ({ projectDir, workflow }) =>
        commitWorkflowChanges(projectDir, workflow.runDirPath),
    },
    {
      id: "request-restart",
      type: "restart",
      when: stepCommitted("commit"),
      reason: "decomposer committed new subtasks to ready queue",
      requires: ["commit"],
    },
  ],
};

export default decomposerWorkflow;
