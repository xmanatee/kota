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
const legacyStateSchema = z.object({
  version: z.literal(1),
  evidenceRequests: z.array(z.object({ request: evidenceRequestSchema, reviewed: z.record(z.string(), z.string()) }).strict()),
  reviewedEvidenceIds: z.array(z.string()),
  unreviewedSurfaces: z.record(z.string(), z.array(z.enum(SECURITY_REVIEW_SURFACES)).min(1)),
  reviewed: z.record(z.string(), z.object({
    digest: z.string().min(1), surfaces: z.array(z.enum(SECURITY_REVIEW_SURFACES)).min(1),
  }).strict()),
  lastReview: z.object({ runId: z.string(), head: z.string().regex(/^[a-f0-9]{40,64}$/), completedAt: z.string().datetime() }).strict().nullable(),
  pending: z.array(z.object({ runId: z.string(), finding: pendingFindingSchema.omit({ evidenceLineage: true }) }).strict()),
}).strict();
const versionTwoSchema = legacyStateSchema.extend({
  version: z.literal(2),
  pending: z.array(z.object({ runId: z.string(), finding: pendingFindingSchema }).strict()),
  unavailable: z.record(z.string(), z.object({
    requestIds: z.array(z.string()), digest: z.string().min(1), runId: z.string().min(1), rationale: z.string().min(1),
    prerequisites: z.record(z.string(), z.string().min(1)),
  }).strict()),
});
export const pendingSecurityEvidenceSchema = versionTwoSchema.shape.pending.element;
const recoveryBaseSchema = z.object({
  original: z.json(),
  reason: z.string().min(1),
}).strict();
const artifactReferenceSchema = z.object({ runId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const recoverySchema = z.discriminatedUnion("disposition", [
  recoveryBaseSchema.extend({ disposition: z.literal("parked-invalid-evidence"), attemptError: z.string().optional() }),
  recoveryBaseSchema.extend({ disposition: z.literal("reconciled-from-source-artifacts"), source: z.object({
    investigation: artifactReferenceSchema, revalidation: artifactReferenceSchema,
    entry: pendingSecurityEvidenceSchema,
  }).strict() }),
]);
const stateSchema = versionTwoSchema.extend({
  version: z.literal(3),
  recovery: z.array(recoverySchema),
});
export type SecurityReviewState = z.infer<typeof stateSchema>;

/** New control state must be fully valid; only retained reads may quarantine. */
export function validateSecurityReviewState(value: unknown): SecurityReviewState {
  return stateSchema.parse(value);
}

export function decodeSecurityReviewState(value: unknown): SecurityReviewState {
  if (value === null) return { version: 3, reviewed: {}, unreviewedSurfaces: {}, evidenceRequests: [], reviewedEvidenceIds: [], lastReview: null, pending: [], unavailable: {}, recovery: [] };
  const envelope = z.discriminatedUnion("version", [
    legacyStateSchema.extend({ pending: z.array(z.json()) }),
    versionTwoSchema.extend({ pending: z.array(z.json()) }),
    stateSchema.extend({ pending: z.array(z.json()) }),
  ]).parse(value);
  const pending: SecurityReviewState["pending"] = [];
  const recovery: SecurityReviewState["recovery"] = envelope.version === 3 ? [...envelope.recovery] : [];
  for (const original of envelope.pending) {
    const entry = envelope.version === 1
      ? legacyStateSchema.shape.pending.element.safeParse(original)
      : pendingSecurityEvidenceSchema.safeParse(original);
    if (!entry.success) {
      recovery.push({ original, disposition: "parked-invalid-evidence",
        reason: entry.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      });
      continue;
    }
    pending.push({ ...entry.data, finding: { evidenceLineage: null, ...entry.data.finding } });
  }
  return validateSecurityReviewState({ ...envelope, version: 3, pending, recovery,
    unavailable: envelope.version === 1 ? {} : envelope.unavailable,
  });
}

export function securityReviewPathUnavailable(
  state: SecurityReviewState, path: string, digests: Record<string, string>, requestId: string | null,
): boolean {
  const held = state.unavailable[path];
  return Boolean(held && held.digest === digests[path] &&
    (requestId === null || held.requestIds.includes(requestId)) &&
    Object.entries(held.prerequisites).every(([prerequisite, digest]) => digests[prerequisite] === digest));
}
