import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
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
