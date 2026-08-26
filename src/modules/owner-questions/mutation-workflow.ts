import { join } from "node:path";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import {
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  decodeOwnerQuestionMutationRequest,
  type OwnerQuestionMutationRequest,
  ownerQuestionMutationRequested,
} from "./events.js";

type MutationResult = {
  applied: boolean;
  questionId: string;
  reason: string;
  pendingCount: number;
};

const inspectRequest = typedCodeStep<OwnerQuestionMutationRequest>({
  id: "inspect-request",
  type: "code",
  validate: (raw) => decodeOwnerQuestionMutationRequest(raw as object),
  run: ({ trigger }) => decodeOwnerQuestionMutationRequest(trigger.payload),
});

const applyMutation = typedCodeStep<MutationResult>({
  id: "apply-mutation",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<MutationResult>(raw, [
      "applied",
      "questionId",
      "reason",
      "pendingCount",
    ]),
  run: (ctx) => {
    const request = inspectRequest.outputRequired(ctx);
    const queue = new OwnerQuestionQueue(
      join(ctx.scopeDir, ".kota", "owner-questions"),
    );
    const current = queue.get(request.questionId);
    const replay = current?.status === "dismissed" &&
      current.dismissalReason === request.reason &&
      current.resolutionSource === request.resolutionSource;
    const applied = replay || current?.status === "pending";
    if (current?.status === "pending") {
      queue.dismiss(
        request.questionId,
        request.reason,
        request.resolutionSource,
      );
    }
    return {
      applied,
      questionId: request.questionId,
      reason: request.reason,
      pendingCount: queue.count("pending"),
    };
  },
});

const emitMutation = typedCodeStep<{ emitted: boolean }>({
  id: "emit-mutation",
  type: "code",
  validate: (raw) => expectStructuredOutput<{ emitted: boolean }>(raw, ["emitted"]),
  run: (ctx) => {
    const result = applyMutation.outputRequired(ctx);
    if (!result.applied) return { emitted: false };
    ctx.emit(
      "owner.question.resolved",
      { id: result.questionId, answered: false, answer: "" },
      { delivery: "on-run-success", stepId: "owner-question-resolved" },
    );
    ctx.emit(
      "owner.question.dismissed",
      { id: result.questionId, reason: result.reason },
      { delivery: "on-run-success", stepId: "owner-question-dismissed" },
    );
    ctx.emit(
      "owner.question.changed",
      { id: result.questionId, pendingCount: result.pendingCount },
      { delivery: "on-run-success", stepId: "owner-question-changed" },
    );
    return { emitted: true };
  },
});

const ownerQuestionMutationWorkflow: WorkflowDefinitionInput = {
  name: "owner-question-mutation",
  repository: "none",
  resources: ({ trigger }) => {
    const request = decodeOwnerQuestionMutationRequest(trigger.payload);
    return [`owner-question:${request.questionId}`];
  },
  description: "Apply a committed workflow's owner-question mutation request.",
  triggers: [{ event: ownerQuestionMutationRequested.name }],
  steps: [inspectRequest, applyMutation, emitMutation],
};

export default ownerQuestionMutationWorkflow;
