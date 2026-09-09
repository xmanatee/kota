import { z } from "zod";
import { defineScopedModuleEvent } from "#core/events/scope.js";

export const improvementHandoffSchema = z.object({
  owner: z.enum(["scope-improver", "architecture-gardener"]),
  topicKey: z.string().regex(/^improvement:[a-z0-9][a-z0-9:_-]*$/),
  targetScope: z.string().min(1),
  reason: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
}).strict();
export type ImprovementHandoff = z.infer<typeof improvementHandoffSchema>;

export const improvementHandoffObservationSchema = improvementHandoffSchema.extend({
  evidenceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ImprovementHandoffObservation = z.infer<typeof improvementHandoffObservationSchema>;

export const improvementHandoffRequested = defineScopedModuleEvent<{
  owner: ImprovementHandoff["owner"];
  topicKey: string;
  targetScope: string;
  reason: string;
  evidenceRefs: string[];
  evidenceFingerprint: string;
  requestedBy: string;
  idempotencyKey: string;
}>("autonomy.improvement.handoff-requested", [
  "owner", "topicKey", "targetScope", "reason", "evidenceRefs", "evidenceFingerprint", "requestedBy", "idempotencyKey",
], { payloadSchema: { type: "object", properties: {
  owner: { type: "string", enum: ["scope-improver", "architecture-gardener"] },
  topicKey: { type: "string" }, targetScope: { type: "string" }, reason: { type: "string" },
  evidenceRefs: { type: "array", items: { type: "string" } },
  evidenceFingerprint: { type: "string" },
  requestedBy: { type: "string" }, idempotencyKey: { type: "string" },
} }, sensitivity: "internal" });
