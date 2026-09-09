import { defineScopedModuleEvent } from "#core/events/scope.js";

export const architectureReviewRequested = defineScopedModuleEvent<{
  targetScope: string;
  reason: string;
}>("architecture.review.requested", ["targetScope", "reason"], {
  payloadSchema: {
    type: "object",
    properties: { targetScope: { type: "string" }, reason: { type: "string" } },
  },
  sensitivity: "internal",
});
