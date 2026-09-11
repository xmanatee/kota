import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateProgressReviewEvidenceIds } from "./agent-output.js";
import { PROGRESS_REVIEW_ARTIFACT } from "./constants.js";
import type { ProgressReviewArtifact } from "./types.js";

export function writeProgressReviewArtifact(
  runDirPath: string,
  artifact: ProgressReviewArtifact,
): string {
  validateProgressReviewEvidenceIds({
    evidence: artifact.evidence,
    review: artifact.review,
  });
  mkdirSync(runDirPath, { recursive: true });
  const artifactPath = join(runDirPath, PROGRESS_REVIEW_ARTIFACT);
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");
  return artifactPath;
}
