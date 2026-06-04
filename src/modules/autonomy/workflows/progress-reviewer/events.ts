import { defineProjectScopedModuleEvent } from "#core/events/project-scope.js";

export type ProgressReviewRequest = {
  reason?: string;
  requestedBy?: string;
  windowMs?: number;
};

export const progressReviewRequested =
  defineProjectScopedModuleEvent<ProgressReviewRequest>(
    "autonomy.progress-review.requested",
    ["reason", "requestedBy", "windowMs"],
    {
      payloadSchema: {
        type: "object",
        properties: {
          reason: { type: "string", required: false },
          requestedBy: { type: "string", required: false },
          windowMs: { type: "number", required: false },
        },
      },
      sensitivity: "internal",
    },
  );
