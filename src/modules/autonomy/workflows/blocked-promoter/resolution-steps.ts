import {
  expectArrayOutput,
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import type { MoveTaskResult } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  applyAskOutcomeOperation,
  type InspectBlockedResult,
  inspectBlockedOperation,
  instructOperatorCaptureOperation,
  promoteSatisfiedBlockedTasksOperation,
} from "./blocking-operations.js";
import {
  BLOCKED_OWNER_DECISION_RESOLVED_EVENT,
  type BlockedOwnerDecisionResolution,
  decodeBlockedOwnerDecisionResolution,
  ownerAskCandidateForWorkspace,
} from "./owner-decision-follow-up.js";
import type {
  AskOutcomeApplication,
  OperatorCaptureInstruction,
  OwnerAskCandidate,
} from "./promotion.js";

export const inspectBlocked = typedCodeStep<InspectBlockedResult>({
  id: "inspect-blocked",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<InspectBlockedResult>(raw, [
      "dirty",
      "blockedCount",
      "ownerAsk",
      "actions",
    ]),
  run: ({ workspaceRoot, scopeRoot, runBlocking }) =>
    runBlocking(inspectBlockedOperation, {
      workspaceRoot,
      scopeRoot,
      nowMs: Date.now(),
    }),
});

type DeterministicPromotion = { promotions: MoveTaskResult[] };

export const promoteDeterministic = typedCodeStep<DeterministicPromotion>({
  id: "promote-deterministic",
  type: "code",
  when: (ctx) => {
    const inspection = inspectBlocked.outputRequired(ctx);
    return !inspection.dirty && inspection.blockedCount > 0;
  },
  validate: (raw) =>
    expectStructuredOutput<DeterministicPromotion>(raw, ["promotions"]),
  run: ({ workspaceRoot, scopeRoot, runBlocking }) =>
    runBlocking(promoteSatisfiedBlockedTasksOperation, { workspaceRoot, scopeRoot }),
});

export function displayedOwnerAnswers(candidate: OwnerAskCandidate): string[] {
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

export const inspectOwnerDecisionResolution =
  typedCodeStep<BlockedOwnerDecisionResolution>({
    id: "inspect-owner-decision-resolution",
    type: "code",
    when: (ctx) => ctx.trigger.event === BLOCKED_OWNER_DECISION_RESOLVED_EVENT,
    validate: (raw) => decodeBlockedOwnerDecisionResolution(raw as object),
    run: ({ trigger }) => decodeBlockedOwnerDecisionResolution(trigger.payload),
  });

export const applyOutcome = typedCodeStep<AskOutcomeApplication[]>({
  id: "apply-ask-outcome",
  type: "code",
  when: (ctx) =>
    inspectBlocked.output(ctx)?.dirty === false &&
    inspectOwnerDecisionResolution.output(ctx) !== undefined,
  validate: (raw) =>
    expectArrayOutput<AskOutcomeApplication>(raw, (item) =>
      expectStructuredOutput<AskOutcomeApplication>(item, ["kind", "slot"]),
    ),
  run: async (ctx) => {
    const resolution = inspectOwnerDecisionResolution.outputRequired(ctx);
    return await ctx.runBlocking(applyAskOutcomeOperation, {
      workspaceRoot: ctx.workspaceRoot,
      candidate: ownerAskCandidateForWorkspace(
        ctx.workspaceRoot,
        resolution.candidate,
      ),
      approved: resolution.approved,
      nowIso: resolution.decidedAt,
    });
  },
});

export const promoteAfterApproval = typedCodeStep<DeterministicPromotion>({
  id: "promote-after-approval",
  type: "code",
  when: (ctx) =>
    inspectOwnerDecisionResolution.output(ctx)?.approved === true &&
    (applyOutcome.output(ctx) ?? []).some((application) => application.kind === "resolved"),
  validate: (raw) =>
    expectStructuredOutput<DeterministicPromotion>(raw, ["promotions"]),
  run: ({ workspaceRoot, scopeRoot, runBlocking }) =>
    runBlocking(promoteSatisfiedBlockedTasksOperation, { workspaceRoot, scopeRoot }),
});

export const instructOperatorCapture = typedCodeStep<{
  instructions: OperatorCaptureInstruction[];
}>({
  id: "instruct-operator-capture",
  type: "code",
  when: (ctx) => {
    const inspection = inspectBlocked.outputRequired(ctx);
    return !inspection.dirty &&
      inspection.actions.some((action) => action.kind === "operator-capture-due");
  },
  validate: (raw) =>
    expectStructuredOutput<{ instructions: OperatorCaptureInstruction[] }>(raw, [
      "instructions",
    ]),
  run: ({ workspaceRoot, scopeRoot, runBlocking }) =>
    runBlocking(instructOperatorCaptureOperation, {
      workspaceRoot,
      scopeRoot,
      nowMs: Date.now(),
    }),
});
