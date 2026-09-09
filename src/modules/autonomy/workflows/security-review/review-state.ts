import { z } from "zod";
import { investigationFindingSchema } from "./security-review-output.js";
import { isSafeRepoRelativePath, SECURITY_REVIEW_SURFACES } from "./security-review-scan-model.js";

export const SECURITY_REVIEW_STATE_KEY = "autonomy.security-review.evidence";
export const SECURITY_REVIEW_RESOURCE = "autonomy:security-review";
const pendingFindingSchema = investigationFindingSchema.extend({
  verdict: z.literal("confirmed"), rationale: z.string().min(1),
});
export const evidenceRequestSchema = z.object({
  id: z.string().min(1), paths: z.array(z.string().refine(isSafeRepoRelativePath)).min(1),
  critical: z.boolean(), reason: z.string().min(1),
}).strict();
export type EvidenceRequest = z.infer<typeof evidenceRequestSchema>;
const stateSchema = z.object({
  version: z.literal(1),
  evidenceRequests: z.array(z.object({ request: evidenceRequestSchema, reviewed: z.record(z.string(), z.string()) }).strict()),
  reviewedEvidenceIds: z.array(z.string()),
  unreviewedSurfaces: z.record(z.string(), z.array(z.enum(SECURITY_REVIEW_SURFACES)).min(1)),
  reviewed: z.record(z.string(), z.object({
    digest: z.string().min(1), surfaces: z.array(z.enum(SECURITY_REVIEW_SURFACES)).min(1),
  }).strict()),
  lastReview: z.object({ runId: z.string(), head: z.string().regex(/^[a-f0-9]{40,64}$/), completedAt: z.string().datetime() }).strict().nullable(),
  pending: z.array(z.object({ runId: z.string(), finding: pendingFindingSchema }).strict()),
}).strict();
export type SecurityReviewState = z.infer<typeof stateSchema>;
export function decodeSecurityReviewState(value: unknown): SecurityReviewState {
  return value === null ? { version: 1, reviewed: {}, unreviewedSurfaces: {}, evidenceRequests: [], reviewedEvidenceIds: [], lastReview: null, pending: [] } : stateSchema.parse(value);
}
