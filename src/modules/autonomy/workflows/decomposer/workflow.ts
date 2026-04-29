import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { askOwnerSteps } from "#core/workflow/ask-owner-step.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { labeledPredicate } from "#core/workflow/run-types.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/types.js";
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

export const agent: AgentDef = {
  name: "decomposer",
  role: "Decompose builder-timeout tasks into coherent task sequences.",
  promptPath: "src/modules/autonomy/workflows/decomposer/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  writeScope: ["data/tasks/"],
};

const TIMEOUT_THRESHOLD_MS = AUTONOMY_AGENT_HANG_TIMEOUT_MS;

/**
 * Operator-only ambiguities the agent loop cannot resolve from repo state
 * alone. When set on the assessment, the workflow opens an `askOwnerSteps`
 * recipe instead of silently skipping the run.
 */
export type DecomposerEscalation = {
  kind: "task-not-found";
  /**
   * Task id extracted from the recovery payload's worktreeSummary. The task
   * is no longer in any active state, so the operator is the only one who
   * knows whether it should be decomposed anyway or whether the trigger
   * should be dropped.
   */
  candidateTaskId: string;
};

export type DecomposerAssessment = {
  reason: string;
  failedRunId: string;
  failedRunDir: string;
  isTimeout: boolean;
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

function findTaskInState(projectDir: string, state: string): { id: string; path: string } | null {
  const dir = join(projectDir, "data", "tasks", state);
  if (!existsSync(dir)) {
    return null;
  }
  const entries = readdirSync(dir);
  const taskFile = entries.find((f) => f.startsWith("task-") && f.endsWith(".md"));
  if (!taskFile) return null;
  const id = taskFile.replace(/\.md$/, "");
  return { id, path: join("data", "tasks", state, taskFile) };
}

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

// Pre-stash rename signal in the recovery payload's worktreeSummary:
// "R  data/tasks/ready/task-X.md -> data/tasks/doing/task-X.md, ...".
// The rename is reverted by the stash that runs before assess-failure, so the
// task file lives back in ready/ — we extract the id from the summary itself.
function extractTaskIdFromWorktreeSummary(summary: string): string | null {
  const match = /data\/tasks\/(?:doing|blocked)\/(task-[a-z0-9-]+)\.md/i.exec(summary);
  return match ? match[1] : null;
}

type ResolvedSource = {
  runId: string;
  runDir: string;
  /** When present, pre-stash worktree rename signal used to identify the failed task. */
  worktreeSummary: string | null;
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
      return { runId: "", runDir: "", worktreeSummary: null, skip: true };
    }
    const sourceRunId = payload.sourceRunId;
    if (typeof sourceRunId !== "string" || sourceRunId.length === 0) {
      throw new Error(
        "Decomposer recovery trigger payload must include sourceRunId when sourceWorkflow is builder",
      );
    }
    const worktreeSummary =
      typeof payload.worktreeSummary === "string" ? payload.worktreeSummary : null;
    return {
      runId: sourceRunId,
      runDir: join(".kota", "runs", sourceRunId),
      worktreeSummary,
      skip: false,
    };
  }

  const runDir = payload.runDir;
  const runId = payload.runId;
  if (typeof runDir !== "string" || typeof runId !== "string") {
    throw new Error("Decomposer trigger payload must include runDir and runId");
  }
  return { runId, runDir, worktreeSummary: null, skip: false };
}

function isTimeoutShaped(metadata: WorkflowRunMetadata): boolean {
  const buildStep = metadata.steps.find((s) => s.id === "build");
  if (!buildStep || buildStep.status !== "failed") return false;

  if (buildStep.durationMs >= TIMEOUT_THRESHOLD_MS) return true;

  const stepError = buildStep.error ?? "";
  if (/time.?out|timed.?out|deadline.?exceeded/i.test(stepError)) return true;

  const errorPath = join(metadata.runDir, "error.txt");
  if (existsSync(errorPath)) {
    const errorTxt = readFileSync(errorPath, "utf-8");
    if (/time.?out|timed.?out|deadline.?exceeded/i.test(errorTxt)) return true;
  }

  return false;
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
      isTimeout: false,
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
      isTimeout: false,
      escalation: null,
    };
  }

  if (!isTimeoutShaped(metadata)) {
    return {
      shouldDecompose: false,
      reason: "Builder failure does not look timeout-shaped",
      failedRunId: source.runId,
      failedRunDir: source.runDir,
      isTimeout: false,
      escalation: null,
    };
  }

  // Recovery path: the failed builder's rename was reverted by the stash step,
  // so the task file is back in ready/. Use the pre-stash worktreeSummary to
  // identify which task, then look it up across task states.
  const candidateId = source.worktreeSummary
    ? extractTaskIdFromWorktreeSummary(source.worktreeSummary)
    : null;
  const task = source.worktreeSummary
    ? candidateId
      ? findTaskById(projectDir, candidateId)
      : null
    : findTaskInState(projectDir, "doing");

  if (!task) {
    // The recovery payload pointed at a candidate task id but the file is no
    // longer in any active state — typically because the operator manually
    // moved it to dropped/ or done/ between the failure and recovery dispatch.
    // The decision to decompose anyway, name a different task, or drop the
    // trigger lives outside the repo, so escalate via askOwnerSteps.
    const escalation: DecomposerEscalation | null = candidateId
      ? { kind: "task-not-found", candidateTaskId: candidateId }
      : null;
    return {
      shouldDecompose: false,
      reason: source.worktreeSummary
        ? "Could not identify the failed task from the recovery payload worktree summary"
        : "No builder-claimed task found in doing/ to decompose",
      failedRunId: source.runId,
      failedRunDir: source.runDir,
      isTimeout: true,
      escalation,
    };
  }

  return {
    shouldDecompose: true,
    reason: `Builder timed out on ${task.id} — decomposing`,
    failedRunId: source.runId,
    failedRunDir: source.runDir,
    taskId: task.id,
    taskPath: task.path,
    isTimeout: true,
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
      "isTimeout",
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
        `timeout-shaped, but the candidate task "${candidate}" identified from ` +
        "the recovery payload is no longer in any active state " +
        "(doing/, blocked/, ready/). It may have been moved to done/ or dropped/ " +
        "after the failure but before recovery dispatch.",
      question:
        `Should we decompose "${candidate}" anyway, or drop this trigger?`,
      reason:
        "Only the operator knows whether the task was intentionally moved out of " +
        "the active queue. Decomposing a task the operator already resolved would " +
        "create stale subtasks; dropping a task that was timing out for a real " +
        "reason loses the failure signal.",
      proposedAnswers: [`decompose ${candidate}`, "drop trigger"],
      source: "decomposer",
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

const decomposerWorkflow: WorkflowDefinitionInput = {
  name: "decomposer",
  description:
    "Decompose builder-timeout tasks into coherent task sequences.",
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
      model: agent.model,
      effort: agent.effort,
      disallowedTools: AUTONOMY_DISALLOWED_TOOLS,
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
      when: shouldRunDecompose,
      repairLoop: {
        checks: [
          {
            id: "task-queue-valid",
            type: "code" as const,
            run: (ctx) =>
              runCheck("pnpm run validate-tasks", ctx.projectDir),
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
