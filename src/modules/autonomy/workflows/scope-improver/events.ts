import { defineProjectScopedModuleEvent } from "#core/events/project-scope.js";

export type ScopeImprovementRequest = {
  automatic?: boolean;
  boundary?: "initial-onboarding" | "content-policy-changed" | "explicit-request";
  fingerprint?: string;
  deliveryAttempt?: number;
  idempotencyKey?: string;
  evidenceRefs?: string[];
  reason?: string;
  requestedBy?: string;
};

export const scopeImprovementRequested =
  defineProjectScopedModuleEvent<ScopeImprovementRequest>(
    "autonomy.scope-improvement.requested",
    [
      "automatic",
      "boundary",
      "fingerprint",
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
          automatic: { type: "boolean", required: false },
          boundary: {
            type: "string",
            enum: [
              "initial-onboarding",
              "content-policy-changed",
              "explicit-request",
            ],
            required: false,
          },
          fingerprint: { type: "string", required: false },
          deliveryAttempt: { type: "number", required: false },
          idempotencyKey: { type: "string", required: false },
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

/** Material post-onboarding changes coalesce independently of explicit runs. */
export const scopeImprovementChanged =
  defineProjectScopedModuleEvent<ScopeImprovementRequest>(
    "autonomy.scope-improvement.changed",
    [
      "automatic",
      "boundary",
      "fingerprint",
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
            enum: ["content-policy-changed"],
          },
          fingerprint: { type: "string" },
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
