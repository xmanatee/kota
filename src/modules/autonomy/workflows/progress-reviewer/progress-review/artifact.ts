import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildProgressReviewScrutinyRecordFromReview,
  writeReviewScrutinyRecord,
} from "#modules/autonomy/review-scrutiny.js";
import { validateProgressReviewEvidenceIds } from "./agent-output.js";
import { PROGRESS_REVIEW_ARTIFACT } from "./constants.js";
import type { ProgressReviewArtifact } from "./types.js";

export function writeProgressReviewArtifact(
  runDirPath: string,
  artifact: ProgressReviewArtifact,
  context?: { runId: string; workflow: string },
): string {
  validateProgressReviewEvidenceIds({
    evidence: artifact.evidence,
    review: artifact.review,
  });
  mkdirSync(runDirPath, { recursive: true });
  const artifactPath = join(runDirPath, PROGRESS_REVIEW_ARTIFACT);
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");
  const record = buildProgressReviewScrutinyRecordFromReview({
    runId: context?.runId ?? "unknown",
    workflow: context?.workflow ?? "progress-reviewer",
    generatedAt: artifact.generatedAt,
    decision: artifact.review.verdict,
    summary: artifact.review.summary,
    findingGroups: [
      artifact.review.findings.crossScope,
      artifact.review.findings.localScope,
    ],
    ownerQuestions: artifact.review.ownerQuestions,
  });
  writeReviewScrutinyRecord(runDirPath, record);
  return artifactPath;
}
