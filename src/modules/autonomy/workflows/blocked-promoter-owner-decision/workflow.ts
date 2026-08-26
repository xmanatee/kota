import { askOwnerSteps } from "#core/workflow/ask-owner-step.js";
import { typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { answerApprovesPromotion } from "#modules/autonomy/workflows/blocked-promoter/owner-decision-authorization.js";
import {
  BLOCKED_OWNER_DECISION_REQUESTED_EVENT,
  BLOCKED_OWNER_DECISION_RESOLVED_EVENT,
  type BlockedOwnerDecisionRequest,
  decodeBlockedOwnerDecisionRequest,
} from "#modules/autonomy/workflows/blocked-promoter/owner-decision-follow-up.js";

const inspectRequest = typedCodeStep<BlockedOwnerDecisionRequest>({
  id: "inspect-request",
  type: "code",
  validate: (raw) => decodeBlockedOwnerDecisionRequest(raw as object),
  run: ({ trigger }) => decodeBlockedOwnerDecisionRequest(trigger.payload),
});

const ownerDecision = askOwnerSteps({
  idPrefix: "blocked-promoter-owner-decision",
  awaitTimeoutMs: 10 * 60 * 1000,
  input: (ctx) => {
    const request = inspectRequest.outputRequired(ctx);
    const candidate = request.candidate;
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
      proposedAnswers: request.displayedAnswers,
      source: "blocked-promoter",
      taskId: candidate.taskId,
    };
  },
});

const workflow: WorkflowDefinitionInput = {
  name: "blocked-promoter-owner-decision",
  repository: "none",
  description: "Ask and await one blocked-task owner decision after writer integration.",
  triggers: [{ event: BLOCKED_OWNER_DECISION_REQUESTED_EVENT }],
  steps: [
    inspectRequest,
    ownerDecision.ask,
    ownerDecision.wait,
    ownerDecision.consume,
    {
      id: "emit-resolution",
      type: "emit",
      event: BLOCKED_OWNER_DECISION_RESOLVED_EVENT,
      payload: (ctx) => {
        const request = inspectRequest.outputRequired(ctx);
        const outcome = ownerDecision.consume.outputRequired(ctx);
        return {
          ...request,
          idempotencyKey: `${request.requestKey}:result`,
          approved: outcome.kind === "answered" &&
            answerApprovesPromotion(
              outcome.answer,
              request.displayedAnswers,
            ),
          outcomeKind: outcome.kind,
          decidedAt: new Date().toISOString(),
        };
      },
    },
  ],
};

export default workflow;
