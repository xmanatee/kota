import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { askOwnerSteps } from "#core/workflow/ask-owner-step.js";
import { labeledPredicate } from "#core/workflow/run-types.js";
import { expectArrayOutput, expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { checkCommitStageable, commitWorkflowChanges } from "#modules/autonomy/commit.js";
import {
  onNormalTrigger,
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import {
  checkCommitMessageExists,
  checkNoScratchArtifacts,
  runCheck,
  stepCommitted,
} from "#modules/autonomy/shared.js";
import type { MoveTaskResult } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  type AskOutcomeApplication,
  answerApprovesPromotion,
  applyAskOutcome,
  applyOperatorCaptureInstruction,
  type BlockerAction,
  classifyBlockedActions,
  listBlockedTasksWithPreconditions,
  listOperatorCaptureInstructCandidates,
  type OperatorCaptureInstruction,
  type OwnerAskCandidate,
  pickOwnerAskCandidate,
  promoteSatisfiedBlockedTasks,
} from "./promotion.js";

type InspectResult = {
  dirty: boolean;
  blockedCount: number;
  ownerAsk: OwnerAskCandidate | null;
  actions: BlockerAction[];
};

const inspectBlocked = typedCodeStep<InspectResult>({
  id: "inspect-blocked",
  type: "code",
  when: onNormalTrigger,
  validate: (raw) =>
    expectStructuredOutput<InspectResult>(raw, [
      "dirty",
      "blockedCount",
      "ownerAsk",
      "actions",
    ]),
  run: ({ projectDir }) => {
    const worktree = getRepoWorktreeStatus(projectDir);
    const dirty = worktree.available && worktree.trackedDirty;
    const records = listBlockedTasksWithPreconditions(projectDir);
    const now = Date.now();
    const ownerAsk = pickOwnerAskCandidate(records, now);
    const actions = classifyBlockedActions(records, projectDir, now);
    return {
      dirty,
      blockedCount: records.length,
      ownerAsk,
      actions,
    };
  },
});

type DeterministicPromotion = {
  promotions: MoveTaskResult[];
};

const promoteDeterministic = typedCodeStep<DeterministicPromotion>({
  id: "promote-deterministic",
  type: "code",
  when: (ctx) => {
    if (ctx.trigger.event === "runtime.recovered") return false;
    const inspection = inspectBlocked.outputRequired(ctx);
    return !inspection.dirty && inspection.blockedCount > 0;
  },
  validate: (raw) =>
    expectStructuredOutput<DeterministicPromotion>(raw, ["promotions"]),
  run: ({ projectDir }) => promoteSatisfiedBlockedTasks(projectDir),
});

const ownerAskGate = labeledPredicate(
  "no-owner-ask-due",
  (ctx) => {
    if (ctx.trigger.event === "runtime.recovered") return false;
    const inspection = inspectBlocked.outputRequired(ctx);
    return !inspection.dirty && inspection.ownerAsk !== null;
  },
);

function reorderProposedAnswers(
  proposed: string[],
  recommended: string | null,
): string[] {
  if (!recommended) return proposed;
  const idx = proposed.findIndex(
    (a) => a.trim().toLowerCase() === recommended.trim().toLowerCase(),
  );
  if (idx <= 0) return proposed;
  const head = proposed[idx];
  return [head, ...proposed.slice(0, idx), ...proposed.slice(idx + 1)];
}

const askSteps = askOwnerSteps({
  idPrefix: "blocked-promoter-ask",
  awaitTimeoutMs: 10 * 60 * 1000,
  input: (ctx) => {
    const candidate = inspectBlocked.outputRequired(ctx).ownerAsk;
    if (!candidate) {
      throw new Error(
        "blocked-promoter ask step ran without an owner-ask candidate — gate predicate is broken",
      );
    }
    const baseProposed =
      candidate.proposedAnswers.length > 0
        ? candidate.proposedAnswers
        : ["unblock"];
    const reordered = reorderProposedAnswers(
      baseProposed,
      candidate.recommendedAnswer,
    );
    const ensureUnblock = reordered.includes("unblock")
      ? reordered
      : [...reordered, "unblock"];
    const recommendationLine = candidate.recommendedAnswer
      ? `\n\nRecommended option: ${candidate.recommendedAnswer}.`
      : "";
    return {
      context: candidate.context
        ? `${candidate.context}\n\nBlocked task: ${candidate.taskId} (slot ${candidate.slot}).${recommendationLine}`
        : `Blocked task: ${candidate.taskId} (slot ${candidate.slot}).${recommendationLine}`,
      question: candidate.question,
      reason: candidate.recommendedAnswer
        ? "Re-asking on the 14-day cadence so a stale owner-decision blocker " +
          "does not silently absorb queue capacity. Recommended default: " +
          `'${candidate.recommendedAnswer}'. Reply with the chosen variant or ` +
          "'unblock' to promote the task; any other answer just refreshes the " +
          "asked marker."
        : "Re-asking on the 14-day cadence so a stale owner-decision blocker " +
          "does not silently absorb queue capacity. Reply with the chosen " +
          "variant or 'unblock' to promote the task; any other answer just " +
          "refreshes the asked marker.",
      proposedAnswers: ensureUnblock,
      source: "blocked-promoter",
    };
  },
});

const askStep = { ...askSteps.ask, when: ownerAskGate };
const waitStep = { ...askSteps.wait, when: ownerAskGate };
const consumeStep = { ...askSteps.consume, when: ownerAskGate };

const applyOutcome = typedCodeStep<AskOutcomeApplication[]>({
  id: "apply-ask-outcome",
  type: "code",
  when: ownerAskGate,
  validate: (raw) =>
    expectArrayOutput<AskOutcomeApplication>(raw, (item) =>
      expectStructuredOutput<AskOutcomeApplication>(item, ["kind", "slot"]),
    ),
  run: (ctx) => {
    const candidate = inspectBlocked.outputRequired(ctx).ownerAsk;
    if (!candidate) {
      throw new Error(
        "blocked-promoter apply-ask-outcome ran without an owner-ask candidate",
      );
    }
    const outcome = askSteps.consume.outputRequired(ctx);
    let approved = false;
    if (outcome.kind === "answered") {
      approved = answerApprovesPromotion(outcome.answer, candidate.proposedAnswers);
    }
    return applyAskOutcome({ candidate, approved, now: new Date() });
  },
});

const promoteAfterApproval = typedCodeStep<DeterministicPromotion>({
  id: "promote-after-approval",
  type: "code",
  when: (ctx) => {
    if (!ownerAskGate(ctx)) return false;
    const apps = applyOutcome.output(ctx);
    if (!apps) return false;
    return apps.some((app) => app.kind === "resolved");
  },
  validate: (raw) =>
    expectStructuredOutput<DeterministicPromotion>(raw, ["promotions"]),
  run: ({ projectDir }) => promoteSatisfiedBlockedTasks(projectDir),
});

const instructOperatorCapture = typedCodeStep<{
  instructions: OperatorCaptureInstruction[];
}>({
  id: "instruct-operator-capture",
  type: "code",
  when: (ctx) => {
    if (ctx.trigger.event === "runtime.recovered") return false;
    const inspection = inspectBlocked.outputRequired(ctx);
    if (inspection.dirty) return false;
    return inspection.actions.some((a) => a.kind === "operator-capture-due");
  },
  validate: (raw) =>
    expectStructuredOutput<{ instructions: OperatorCaptureInstruction[] }>(raw, [
      "instructions",
    ]),
  run: ({ projectDir }) => {
    const records = listBlockedTasksWithPreconditions(projectDir);
    const candidates = listOperatorCaptureInstructCandidates(records, Date.now());
    const now = new Date();
    const instructions = candidates.map((candidate) =>
      applyOperatorCaptureInstruction({ candidate, now }),
    );
    return { instructions };
  },
});

const writeBlockerActions = typedCodeStep<{ written: boolean; path: string }>({
  id: "write-blocker-actions",
  type: "code",
  when: (ctx) => {
    if (ctx.trigger.event === "runtime.recovered") return false;
    const inspection = inspectBlocked.output(ctx);
    return inspection !== undefined && inspection.actions.length > 0;
  },
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean; path: string }>(raw, [
      "written",
      "path",
    ]),
  run: (ctx) => {
    const inspection = inspectBlocked.outputRequired(ctx);
    const instructions =
      instructOperatorCapture.output(ctx)?.instructions ?? [];
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    const filePath = join(ctx.workflow.runDirPath, "blocker-actions.json");
    writeFileSync(
      filePath,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          actions: inspection.actions,
          operatorCaptureInstructionsEmitted: instructions,
        },
        null,
        2,
      )}\n`,
    );
    return { written: true, path: filePath };
  },
});

function workflowChangedAnything(
  promotions: number,
  followups: number,
  applications: number,
  instructions: number,
): boolean {
  return promotions + followups + applications + instructions > 0;
}

const writeCommitMessage = typedCodeStep<{ written: boolean }>({
  id: "write-commit-message",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean }>(raw, ["written"]),
  when: (ctx) => {
    if (ctx.trigger.event === "runtime.recovered") return false;
    const promotions = (promoteDeterministic.output(ctx)?.promotions ?? []).length;
    const followups = (promoteAfterApproval.output(ctx)?.promotions ?? []).length;
    const apps = (applyOutcome.output(ctx) ?? []).length;
    const instructions =
      (instructOperatorCapture.output(ctx)?.instructions ?? []).length;
    return workflowChangedAnything(promotions, followups, apps, instructions);
  },
  run: (ctx) => {
    const deterministic = promoteDeterministic.output(ctx)?.promotions ?? [];
    const followups = promoteAfterApproval.output(ctx)?.promotions ?? [];
    const apps = applyOutcome.output(ctx) ?? [];
    const instructions =
      instructOperatorCapture.output(ctx)?.instructions ?? [];
    const lines: string[] = [
      "blocked-promoter: auto-promote satisfied blocked tasks, refresh owner-ask cadence, and refresh operator-capture instruction markers",
      "",
    ];
    for (const move of deterministic) {
      lines.push(`- promote ${move.id}: blocked -> ${move.toState} (precondition satisfied)`);
    }
    for (const move of followups) {
      lines.push(`- promote ${move.id}: blocked -> ${move.toState} (operator approved)`);
    }
    for (const app of apps) {
      if (app.kind === "asked") {
        lines.push(`- refresh asked marker for slot ${app.slot} at ${app.lastAskedAt}`);
      } else {
        lines.push(`- write resolved marker for slot ${app.slot} at ${app.resolvedAt}`);
      }
    }
    for (const instruction of instructions) {
      lines.push(
        `- instruct operator capture for ${instruction.taskId} (${instruction.capturePath}, blocked ${instruction.ageDays}d)`,
      );
    }
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    writeFileSync(
      join(ctx.workflow.runDirPath, "commit-message.txt"),
      `${lines.join("\n")}\n`,
    );
    return { written: true };
  },
});

const validateBeforeCommit = typedCodeStep<{ ok: true }>({
  id: "validate-before-commit",
  type: "code",
  when: (ctx) => writeCommitMessage.output(ctx)?.written === true,
  validate: (raw) => {
    const obj = expectStructuredOutput<{ ok: true }>(raw, ["ok"]);
    if (obj.ok !== true) throw new Error(`expected ok: true, got ${String(obj.ok)}`);
    return obj;
  },
  run: (ctx) => {
    runCheck("pnpm run validate-tasks", ctx.projectDir);
    checkNoScratchArtifacts(ctx.projectDir);
    checkCommitStageable(ctx.projectDir);
    checkCommitMessageExists(ctx.workflow.runDirPath, ctx.projectDir);
    return { ok: true } as const;
  },
});

const commitChanges = typedCodeStep<{ committed: boolean }>({
  id: "commit",
  type: "code",
  when: (ctx) => validateBeforeCommit.output(ctx)?.ok === true,
  validate: (raw) =>
    expectStructuredOutput<{ committed: boolean }>(raw, ["committed"]),
  run: ({ projectDir, workflow }) => {
    const result = commitWorkflowChanges(projectDir, workflow.runDirPath);
    return { committed: Boolean(result.committed) };
  },
});

const blockedPromoterWorkflow: WorkflowDefinitionInput = {
  name: "blocked-promoter",
  description:
    "Auto-promote blocked tasks whose typed unblock precondition is satisfied; re-ask owner-decision slots on a 14-day cadence.",
  tags: ["monitored"],
  recoveryCapable: true,
  // Code-only workflow — no agent step. defaultAutonomyMode is omitted because
  // the workflow has no agent step to inherit it.
  triggers: [
    {
      event: "autonomy.queue.available",
      cooldownMs: 60_000,
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
        resetWorktreeForRecovery({ projectDir, workflowName: "blocked-promoter" }),
    },
    inspectBlocked,
    promoteDeterministic,
    askStep,
    waitStep,
    consumeStep,
    applyOutcome,
    promoteAfterApproval,
    instructOperatorCapture,
    writeBlockerActions,
    writeCommitMessage,
    validateBeforeCommit,
    commitChanges,
    {
      id: "emit-promoted",
      type: "emit",
      when: (ctx) => {
        if (!stepCommitted("commit")(ctx)) return false;
        const total =
          (promoteDeterministic.output(ctx)?.promotions ?? []).length +
          (promoteAfterApproval.output(ctx)?.promotions ?? []).length;
        return total > 0;
      },
      event: "autonomy.blocked.promoted",
      payload: (ctx) => {
        const deterministic = promoteDeterministic.output(ctx)?.promotions ?? [];
        const followups = promoteAfterApproval.output(ctx)?.promotions ?? [];
        const all = [...deterministic, ...followups];
        return {
          runId: ctx.workflow.runId,
          promotedTaskIds: all.map((m) => m.id),
          promotedToReady: all.filter((m) => m.toState === "ready").map((m) => m.id),
          promotedToBacklog: all.filter((m) => m.toState === "backlog").map((m) => m.id),
        };
      },
    },
    {
      id: "emit-operator-capture-instructed",
      type: "emit",
      when: (ctx) => {
        if (!stepCommitted("commit")(ctx)) return false;
        const instructions =
          instructOperatorCapture.output(ctx)?.instructions ?? [];
        return instructions.length > 0;
      },
      event: "autonomy.blocked.operator-capture-instructed",
      payload: (ctx) => {
        const instructions =
          instructOperatorCapture.output(ctx)?.instructions ?? [];
        return {
          runId: ctx.workflow.runId,
          instructions: instructions.map((i) => ({
            taskId: i.taskId,
            capturePath: i.capturePath,
            description: i.description,
            ageDays: i.ageDays,
            instructedAt: i.instructedAt,
          })),
        };
      },
    },
    {
      id: "request-restart",
      type: "restart",
      when: stepCommitted("commit"),
      reason: "blocked-promoter committed task promotions or owner-ask markers",
      requires: ["commit"],
    },
  ],
};

export default blockedPromoterWorkflow;
