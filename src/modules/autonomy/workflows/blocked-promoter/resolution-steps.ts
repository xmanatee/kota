import { askOwnerSteps } from "#core/workflow/ask-owner-step.js";
import { labeledPredicate } from "#core/workflow/run-types.js";
import {
  expectArrayOutput,
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import { onNormalTrigger } from "#modules/autonomy/recovery.js";
import type { MoveTaskResult } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  applyAskOutcomeOperation,
  type InspectBlockedResult,
  inspectBlockedOperation,
  instructOperatorCaptureOperation,
  promoteSatisfiedBlockedTasksOperation,
} from "./blocking-operations.js";
import { answerApprovesPromotion } from "./owner-decision-authorization.js";
import type {
  AskOutcomeApplication,
  OperatorCaptureInstruction,
  OwnerAskCandidate,
} from "./promotion.js";

export const inspectBlocked = typedCodeStep<InspectBlockedResult>({
  id: "inspect-blocked",
  type: "code",
  when: onNormalTrigger,
  validate: (raw) =>
    expectStructuredOutput<InspectBlockedResult>(raw, [
      "dirty",
      "blockedCount",
      "ownerAsk",
      "actions",
    ]),
  run: ({ projectDir, runBlocking }) =>
    runBlocking(inspectBlockedOperation, { projectDir, nowMs: Date.now() }),
});

type DeterministicPromotion = { promotions: MoveTaskResult[] };

export const promoteDeterministic = typedCodeStep<DeterministicPromotion>({
  id: "promote-deterministic",
  type: "code",
  when: (ctx) => {
    if (ctx.trigger.event === "runtime.recovered") return false;
    const inspection = inspectBlocked.outputRequired(ctx);
    return !inspection.dirty && inspection.blockedCount > 0;
  },
  validate: (raw) =>
    expectStructuredOutput<DeterministicPromotion>(raw, ["promotions"]),
  run: ({ projectDir, runBlocking }) =>
    runBlocking(promoteSatisfiedBlockedTasksOperation, { projectDir }),
});

const ownerAskGate = labeledPredicate("no-owner-ask-due", (ctx) => {
  if (ctx.trigger.event === "runtime.recovered") return false;
  const inspection = inspectBlocked.outputRequired(ctx);
  return !inspection.dirty && inspection.ownerAsk !== null;
});

function displayedOwnerAnswers(candidate: OwnerAskCandidate): string[] {
  const proposed = candidate.proposedAnswers.length > 0
    ? candidate.proposedAnswers
    : ["unblock"];
  const recommended = candidate.recommendedAnswer?.trim().toLowerCase();
  const recommendedIndex = recommended
    ? proposed.findIndex((answer) => answer.trim().toLowerCase() === recommended)
    : -1;
  const reordered = recommendedIndex > 0
    ? [
        proposed[recommendedIndex]!,
        ...proposed.slice(0, recommendedIndex),
        ...proposed.slice(recommendedIndex + 1),
      ]
    : proposed;
  return reordered.some((answer) => answer.trim().toLowerCase() === "unblock")
    ? reordered
    : [...reordered, "unblock"];
}

const askSteps = askOwnerSteps({
  idPrefix: "blocked-promoter-ask",
  awaitTimeoutMs: 10 * 60 * 1000,
  input: (ctx) => {
    const candidate = inspectBlocked.outputRequired(ctx).ownerAsk;
    if (!candidate) {
      throw new Error("blocked-promoter ask step ran without an owner-ask candidate");
    }
    const recommendationLine = candidate.recommendedAnswer
      ? `\n\nRecommended option: ${candidate.recommendedAnswer}.`
      : "";
    return {
      context: candidate.context
        ? `${candidate.context}\n\nBlocked task: ${candidate.taskId} (slot ${candidate.slot}).${recommendationLine}`
        : `Blocked task: ${candidate.taskId} (slot ${candidate.slot}).${recommendationLine}`,
      question: candidate.question,
      reason: candidate.recommendedAnswer
        ? "Re-asking on the 14-day cadence. Recommended default: " +
          `'${candidate.recommendedAnswer}'. Reply with the chosen variant or 'unblock' to promote.`
        : "Re-asking on the 14-day cadence. Reply with the chosen variant or 'unblock' to promote.",
      proposedAnswers: displayedOwnerAnswers(candidate),
      source: "blocked-promoter",
      taskId: candidate.taskId,
    };
  },
});

export const askStep = { ...askSteps.ask, when: ownerAskGate };
export const waitStep = { ...askSteps.wait, when: ownerAskGate };
export const consumeStep = { ...askSteps.consume, when: ownerAskGate };

export const applyOutcome = typedCodeStep<AskOutcomeApplication[]>({
  id: "apply-ask-outcome",
  type: "code",
  when: ownerAskGate,
  validate: (raw) =>
    expectArrayOutput<AskOutcomeApplication>(raw, (item) =>
      expectStructuredOutput<AskOutcomeApplication>(item, ["kind", "slot"]),
    ),
  run: async (ctx) => {
    const candidate = inspectBlocked.outputRequired(ctx).ownerAsk;
    if (!candidate) throw new Error("blocked-promoter outcome has no candidate");
    const outcome = askSteps.consume.outputRequired(ctx);
    const approved = outcome.kind === "answered" &&
      answerApprovesPromotion(outcome.answer, displayedOwnerAnswers(candidate));
    return await ctx.runBlocking(applyAskOutcomeOperation, {
      projectDir: ctx.projectDir,
      candidate,
      approved,
      nowIso: new Date().toISOString(),
    });
  },
});

export const promoteAfterApproval = typedCodeStep<DeterministicPromotion>({
  id: "promote-after-approval",
  type: "code",
  when: (ctx) =>
    ownerAskGate(ctx) &&
    (applyOutcome.output(ctx) ?? []).some((application) => application.kind === "resolved"),
  validate: (raw) =>
    expectStructuredOutput<DeterministicPromotion>(raw, ["promotions"]),
  run: ({ projectDir, runBlocking }) =>
    runBlocking(promoteSatisfiedBlockedTasksOperation, { projectDir }),
});

export const instructOperatorCapture = typedCodeStep<{
  instructions: OperatorCaptureInstruction[];
}>({
  id: "instruct-operator-capture",
  type: "code",
  when: (ctx) => {
    if (ctx.trigger.event === "runtime.recovered") return false;
    const inspection = inspectBlocked.outputRequired(ctx);
    return !inspection.dirty &&
      inspection.actions.some((action) => action.kind === "operator-capture-due");
  },
  validate: (raw) =>
    expectStructuredOutput<{ instructions: OperatorCaptureInstruction[] }>(raw, [
      "instructions",
    ]),
  run: ({ projectDir, runBlocking }) =>
    runBlocking(instructOperatorCaptureOperation, {
      projectDir,
      nowMs: Date.now(),
    }),
});
