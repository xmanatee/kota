import { defineScopedModuleEvent } from "#core/events/scope.js";

export type OwnerQuestionMutationRequest = {
  questionId: string;
  mutation: "dismiss";
  reason: string;
  resolutionSource: string;
  idempotencyKey: string;
};

export function ownerQuestionMutationKey(questionId: string): string {
  return `owner-question:${questionId}:dismiss`;
}

export const ownerQuestionMutationRequested =
  defineScopedModuleEvent<OwnerQuestionMutationRequest>(
    "owner.question.mutation.requested",
    [
      "questionId",
      "mutation",
      "reason",
      "resolutionSource",
      "idempotencyKey",
    ],
    {
      payloadSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          questionId: { type: "string" },
          mutation: { type: "string", enum: ["dismiss"] },
          reason: { type: "string" },
          resolutionSource: { type: "string" },
          idempotencyKey: { type: "string" },
        },
      },
      sensitivity: "internal",
    },
  );

export function decodeOwnerQuestionMutationRequest(
  value: object,
): OwnerQuestionMutationRequest {
  const request = value as Partial<OwnerQuestionMutationRequest>;
  if (
    typeof request.questionId !== "string" ||
    request.questionId.trim().length === 0 ||
    request.mutation !== "dismiss" ||
    typeof request.reason !== "string" ||
    request.reason.trim().length === 0 ||
    typeof request.resolutionSource !== "string" ||
    request.resolutionSource.trim().length === 0 ||
    request.idempotencyKey !== ownerQuestionMutationKey(request.questionId)
  ) {
    throw new Error("owner question mutation request is invalid");
  }
  return {
    questionId: request.questionId,
    mutation: request.mutation,
    reason: request.reason,
    resolutionSource: request.resolutionSource,
    idempotencyKey: request.idempotencyKey,
  };
}
