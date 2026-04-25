import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { type AwaitedOwnerOutcome, askOwnerSteps } from "#core/workflow/ask-owner-step.js";
import { labeledPredicate } from "#core/workflow/run-types.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { typedCodeStep } from "#core/workflow/types.js";
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
  listBlockedTasksWithPreconditions,
  type OwnerAskCandidate,
  pickOwnerAskCandidate,
  promoteSatisfiedBlockedTasks,
} from "./promotion.js";

type InspectResult = {
  dirty: boolean;
  blockedCount: number;
  ownerAsk: OwnerAskCandidate | null;
};

const inspectBlocked = typedCodeStep<InspectResult>({
  id: "inspect-blocked",
  type: "code",
  when: onNormalTrigger,
  run: ({ projectDir }) => {
    const worktree = getRepoWorktreeStatus(projectDir);
    const dirty = worktree.available && worktree.trackedDirty;
    const records = listBlockedTasksWithPreconditions(projectDir);
    const ownerAsk = pickOwnerAskCandidate(records, Date.now());
    return {
      dirty,
      blockedCount: records.length,
      ownerAsk,
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
    const inspection = inspectBlocked.output(ctx);
    return !inspection.dirty && inspection.blockedCount > 0;
  },
  run: ({ projectDir }) => promoteSatisfiedBlockedTasks(projectDir),
});

const ownerAskGate = labeledPredicate(
  "no-owner-ask-due",
  (ctx) => {
    if (ctx.trigger.event === "runtime.recovered") return false;
    const inspection = inspectBlocked.output(ctx);
    return !inspection.dirty && inspection.ownerAsk !== null;
  },
);

const askSteps = askOwnerSteps({
  idPrefix: "blocked-promoter-ask",
  awaitTimeoutMs: 10 * 60 * 1000,
  input: (ctx) => {
    const candidate = inspectBlocked.output(ctx).ownerAsk;
    if (!candidate) {
      throw new Error(
        "blocked-promoter ask step ran without an owner-ask candidate — gate predicate is broken",
      );
    }
    const proposed = candidate.proposedAnswers.length > 0
      ? candidate.proposedAnswers
      : ["unblock"];
    const ensureUnblock = proposed.includes("unblock") ? proposed : [...proposed, "unblock"];
    return {
      context: candidate.context
        ? `${candidate.context}\n\nBlocked task: ${candidate.taskId} (slot ${candidate.slot}).`
        : `Blocked task: ${candidate.taskId} (slot ${candidate.slot}).`,
      question: candidate.question,
      reason:
        "Re-asking on the 14-day cadence so a stale owner-decision blocker " +
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
  run: (ctx) => {
    const candidate = inspectBlocked.output(ctx).ownerAsk;
    if (!candidate) {
      throw new Error(
        "blocked-promoter apply-ask-outcome ran without an owner-ask candidate",
      );
    }
    const outcome = askSteps.consume.output(ctx) as AwaitedOwnerOutcome;
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
  run: ({ projectDir }) => promoteSatisfiedBlockedTasks(projectDir),
});

function workflowChangedAnything(
  promotions: number,
  followups: number,
  applications: number,
): boolean {
  return promotions + followups + applications > 0;
}

const writeCommitMessage = typedCodeStep<{ written: boolean }>({
  id: "write-commit-message",
  type: "code",
  when: (ctx) => {
    if (ctx.trigger.event === "runtime.recovered") return false;
    const promotions = (promoteDeterministic.output(ctx)?.promotions ?? []).length;
    const followups = (promoteAfterApproval.output(ctx)?.promotions ?? []).length;
    const apps = (applyOutcome.output(ctx) ?? []).length;
    return workflowChangedAnything(promotions, followups, apps);
  },
  run: (ctx) => {
    const deterministic = promoteDeterministic.output(ctx)?.promotions ?? [];
    const followups = promoteAfterApproval.output(ctx)?.promotions ?? [];
    const apps = applyOutcome.output(ctx) ?? [];
    const lines: string[] = [
      "blocked-promoter: auto-promote satisfied blocked tasks and refresh owner-ask cadence",
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
      id: "request-restart",
      type: "restart",
      when: stepCommitted("commit"),
      reason: "blocked-promoter committed task promotions or owner-ask markers",
      requires: ["commit"],
    },
  ],
};

export default blockedPromoterWorkflow;
