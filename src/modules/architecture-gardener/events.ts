import { defineScopedModuleEvent } from "#core/events/scope.js";

export type ArchitectureReviewRequest = {
  targetScope?: string;
  reason?: string;
  requestedAt?: string;
  fingerprint?: string;
  evidenceRefs?: string[];
  requestedBy?: string;
};

export const architectureReviewRequested =
  defineScopedModuleEvent<ArchitectureReviewRequest>(
    "architecture.review.requested",
    [
      "targetScope",
      "reason",
      "requestedAt",
      "fingerprint",
      "evidenceRefs",
      "requestedBy",
    ],
    {
      payloadSchema: {
        type: "object",
        properties: {
          targetScope: { type: "string", required: false },
          reason: { type: "string", required: false },
          requestedAt: { type: "string", required: false },
          fingerprint: { type: "string", required: false },
          evidenceRefs: {
            type: "array",
            items: { type: "string" },
            required: false,
          },
          requestedBy: { type: "string", required: false },
        },
      },
      sensitivity: "internal",
    },
  );

export const architectureChanged =
  defineScopedModuleEvent<ArchitectureReviewRequest>(
    "architecture.changed",
    [
      "targetScope",
      "reason",
      "requestedAt",
      "fingerprint",
      "evidenceRefs",
      "requestedBy",
    ],
    {
      payloadSchema: {
        type: "object",
        properties: {
          targetScope: { type: "string", required: false },
          reason: { type: "string", required: false },
          requestedAt: { type: "string", required: false },
          fingerprint: { type: "string", required: false },
          evidenceRefs: {
            type: "array",
            items: { type: "string" },
            required: false,
          },
          requestedBy: { type: "string", required: false },
        },
      },
      sensitivity: "internal",
    },
  );
