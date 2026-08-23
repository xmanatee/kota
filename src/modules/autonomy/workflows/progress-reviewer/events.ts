import { defineProjectScopedModuleEvent } from "#core/events/project-scope.js";

export type ProgressReviewRequest = {
  automatic?: boolean;
  boundary?:
    | "parked-queue"
    | "strategic-completion"
    | "task-disposition"
    | "owner-decision-resolution";
  inputRevision?: number;
  deliveryAttempt?: number;
  idempotencyKey?: string;
  evidenceRefs?: string[];
  reason?: string;
  requestedBy?: string;
  windowMs?: number;
};

export const progressReviewRequested =
  defineProjectScopedModuleEvent<ProgressReviewRequest>(
    "autonomy.progress-review.requested",
    [
      "automatic",
      "boundary",
      "inputRevision",
      "deliveryAttempt",
      "idempotencyKey",
      "evidenceRefs",
      "reason",
      "requestedBy",
      "windowMs",
    ],
    {
      payloadSchema: {
        type: "object",
        properties: {
          automatic: { type: "boolean", required: false },
          boundary: {
            type: "string",
            enum: [
              "parked-queue",
              "strategic-completion",
              "task-disposition",
              "owner-decision-resolution",
            ],
            required: false,
          },
          inputRevision: { type: "number", required: false },
          deliveryAttempt: { type: "number", required: false },
          idempotencyKey: { type: "string", required: false },
          evidenceRefs: {
            type: "array",
            items: { type: "string" },
            required: false,
          },
          reason: { type: "string", required: false },
          requestedBy: { type: "string", required: false },
          windowMs: { type: "number", required: false },
        },
      },
      sensitivity: "internal",
    },
  );

/** Dispatcher-owned automatic inputs use a separate latest-only queue slot. */
export const automaticProgressReviewRequested =
  defineProjectScopedModuleEvent<ProgressReviewRequest>(
    "autonomy.progress-review.automatic-requested",
    [
      "automatic",
      "boundary",
      "inputRevision",
      "deliveryAttempt",
      "idempotencyKey",
      "evidenceRefs",
      "reason",
      "requestedBy",
    ],
    {
      payloadSchema: {
        type: "object",
        properties: {
          automatic: { type: "boolean" },
          boundary: {
            type: "string",
            enum: [
              "parked-queue",
              "strategic-completion",
              "task-disposition",
              "owner-decision-resolution",
            ],
          },
          inputRevision: { type: "number" },
          deliveryAttempt: { type: "number" },
          idempotencyKey: { type: "string" },
          evidenceRefs: {
            type: "array",
            items: { type: "string" },
            required: false,
          },
          reason: { type: "string", required: false },
          requestedBy: { type: "string", required: false },
        },
      },
      sensitivity: "internal",
    },
  );
