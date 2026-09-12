import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { projectEvidenceObject } from "#core/evidence/policy.js";
import { evidenceRequestSchema } from "./review-state.js";
import { writeJsonArtifact } from "./security-review-candidates.js";
import { SECURITY_REVIEW_SURFACES } from "./security-review-scan-model.js";

const surfacesSchema = z.record(z.string(), z.array(z.enum(SECURITY_REVIEW_SURFACES)).min(1));
const digestsSchema = z.record(z.string(), z.string().regex(/^(?:[a-f0-9]{40,64}|deleted)$/));
const retainedInputSchema = z.object({
  evidenceRequest: evidenceRequestSchema.nullable(),
  unreviewedSurfaces: surfacesSchema,
}).strict();
const refreshedInputSchema = z.object({
  currentHead: z.object({ kind: z.literal("commit"), sha: z.string().regex(/^[a-f0-9]{40,64}$/) }).strict(),
  changedPaths: z.array(z.string()),
  contentDigests: digestsSchema,
  previousSurfaces: surfacesSchema,
  evidenceRequest: evidenceRequestSchema.nullable(),
  evidenceReviewed: digestsSchema,
  evidencePaths: z.array(z.string()),
}).strict();

export const reviewInputReferenceSchema = z.object({
  runId: z.string().min(1).max(255).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type ReviewInputReference = z.infer<typeof reviewInputReferenceSchema>;

// The ordinary step output carries a bounded reference. Retry replay retains
// its source run, while refreshed evidence is written under the current run.
export function securityReviewArtifact<T>(filename: string, decode: (value: unknown) => T) {
  return {
    write(runDirPath: string, input: T): ReviewInputReference {
      const path = writeJsonArtifact(runDirPath, filename, decode(input));
      return reviewInputReferenceSchema.parse({
        runId: basename(runDirPath),
        sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
      });
    },
    read(runDirPath: string, reference: ReviewInputReference): T {
      const ref = reviewInputReferenceSchema.parse(reference);
      const path = join(dirname(runDirPath), ref.runId, filename);
      const content = readFileSync(path);
      if (createHash("sha256").update(content).digest("hex") !== ref.sha256) {
        throw new Error(`Security review input integrity mismatch: ${path}`);
      }
      return decode(JSON.parse(content.toString("utf8")));
    },
  };
}

export const retainedReviewInputArtifact = securityReviewArtifact("security-review-retained-input.json", (value) => retainedInputSchema.parse(value));
export const refreshedReviewInputArtifact = securityReviewArtifact("security-review-input.json", (value) => refreshedInputSchema.parse(value));

const candidateInputSchema = z.object({
  input: reviewInputReferenceSchema,
  candidates: z.array(z.object({
    id: z.string().min(1), surface: z.enum(SECURITY_REVIEW_SURFACES),
    path: z.string().min(1), line: z.number().int().positive(), matcher: z.string().min(1),
  }).strict()),
  candidateCount: z.number().int().nonnegative(),
  artifactPath: z.string().min(1), truncated: z.boolean(),
}).strict().superRefine((packet, ctx) => {
  if (packet.candidateCount !== packet.candidates.length || new Set(packet.candidates.map(({ id }) => id)).size !== packet.candidateCount) {
    ctx.addIssue({ code: "custom", message: "Security candidate identities/count disagree" });
  }
  if (packet.candidates.some(({ id, surface, path, line }) => id !== `${surface}:${path}:${line}`)) {
    ctx.addIssue({ code: "custom", message: "Security candidate identity differs from its location/surface" });
  }
});

export const candidateReviewInputArtifact = securityReviewArtifact("security-review-scan-input.json", (value) => candidateInputSchema.parse(value));

export function readSecurityReviewCandidates(runDirPath: string, reference: unknown, inputReference: ReviewInputReference) {
  const parsed = reviewInputReferenceSchema.safeParse(reference);
  // Only the old complete packet can take the recovery path. A malformed new
  // reference must never fall back to an unbound source artifact.
  const packet = parsed.success
    ? candidateReviewInputArtifact.read(runDirPath, parsed.data)
    : readLegacyCandidates(runDirPath, reference, inputReference);
  if (packet.input.runId !== inputReference.runId || packet.input.sha256 !== inputReference.sha256) {
    throw new Error("Security candidate scan differs from its pinned input");
  }
  const input = refreshedReviewInputArtifact.read(runDirPath, packet.input);
  if (packet.candidates.some(({ path }) => input.contentDigests[path] === undefined)) {
    throw new Error("Security candidate is outside the pinned Git input");
  }
  return { ...packet, head: input.currentHead.sha, contentDigests: input.contentDigests, reviewInput: input };
}

/** Finalization already carries the runtime-owned source run and its persisted
 * outputs. Older scans lack a candidate hash: verify the complete projection
 * against that run's original source and hash-pinned Git input, never unmask it.
 * Investigation and independent revalidation keep their existing hash checks. */
function readLegacyCandidates(runDirPath: string, projection: unknown, inputReference: ReviewInputReference) {
  const legacy = z.object({
    candidates: z.array(z.unknown()), candidateCount: z.number(),
    artifactPath: z.string(), truncated: z.boolean(), head: z.string(),
    contentDigests: z.record(z.string(), z.unknown()),
  }).strict().parse(projection);
  const artifactPath = join(runDirPath, "security-review-candidates.json");
  if (inputReference.runId !== basename(runDirPath) || legacy.artifactPath !== artifactPath) {
    throw new Error("Legacy security scan source run differs from finalization");
  }
  const input = refreshedReviewInputArtifact.read(runDirPath, inputReference);
  const source = z.object({
    candidates: z.array(z.object({
      id: z.string(), surface: z.enum(SECURITY_REVIEW_SURFACES), path: z.string(),
      line: z.number(), matcher: z.string(), excerpt: z.string(),
    })), candidateCount: z.number(), truncated: z.boolean(),
  }).parse(JSON.parse(readFileSync(artifactPath, "utf8")));
  const packet = candidateInputSchema.parse({
    ...source, candidates: source.candidates.map(({ excerpt: _excerpt, ...candidate }) => candidate),
    input: inputReference, artifactPath,
  });
  for (const candidate of packet.candidates) {
    if (input.contentDigests[candidate.path] === undefined ||
      !(input.previousSurfaces[candidate.path]?.includes(candidate.surface) ||
        (candidate.surface === "reported-boundary" && input.evidencePaths.includes(candidate.path)))) {
      throw new Error("Legacy security candidate is outside the pinned Git input");
    }
  }
  const expected = {
    candidates: packet.candidates, candidateCount: packet.candidateCount, artifactPath,
    truncated: packet.truncated, head: input.currentHead.sha,
    contentDigests: Object.fromEntries(packet.candidates.map(({ path }) => [path, input.contentDigests[path]!])),
  };
  if (!isDeepStrictEqual(projectEvidenceObject(expected, "internal-storage"), legacy)) {
    throw new Error("Legacy security scan source differs from its retained projection");
  }
  return packet;
}
