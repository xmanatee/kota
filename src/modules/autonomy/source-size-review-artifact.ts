import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateSourceFileSize,
  formatSevereSourceFileSizeOutput,
  formatSourceFileSizeReview,
  SOURCE_SIZE_CLEANUP_EXCEPTION_KIND,
  type SourceFileSizeReview,
} from "./source-size-escalation.js";

export const SOURCE_FILE_SIZE_REVIEW_ARTIFACT = "source-file-size-review.json";

function isSourceFileSizeReview(review: SourceFileSizeReview): boolean {
  if (typeof review !== "object" || review === null) return false;
  if (typeof review.message !== "string" || !Array.isArray(review.warnings)) return false;
  if (review.outcome === "ok" || review.outcome === "advisory") return true;
  if (!Array.isArray(review.reasons)) return false;
  if (review.outcome === "blocking") return true;
  return (
    review.outcome === "exception" &&
    typeof review.exception === "object" &&
    review.exception !== null &&
    review.exception.kind === SOURCE_SIZE_CLEANUP_EXCEPTION_KIND &&
    typeof review.exception.taskPath === "string" &&
    Array.isArray(review.exception.files) &&
    Array.isArray(review.exception.reducingFiles)
  );
}

export function writeSourceFileSizeReviewArtifact(
  runDirPath: string,
  review: SourceFileSizeReview,
): void {
  writeFileSync(
    join(runDirPath, SOURCE_FILE_SIZE_REVIEW_ARTIFACT),
    `${formatSourceFileSizeReview(review)}\n`,
  );
}

export function readSourceFileSizeReviewArtifact(
  runDirPath: string,
): SourceFileSizeReview | null {
  const path = join(runDirPath, SOURCE_FILE_SIZE_REVIEW_ARTIFACT);
  if (!existsSync(path)) return null;
  const review = JSON.parse(readFileSync(path, "utf-8")) as SourceFileSizeReview;
  if (!isSourceFileSizeReview(review)) {
    throw new Error(`Malformed ${SOURCE_FILE_SIZE_REVIEW_ARTIFACT}`);
  }
  return review;
}

export function checkSevereSourceFileSizeForRun(
  projectDir: string,
  runDirPath: string,
): string {
  const review = evaluateSourceFileSize(projectDir);
  writeSourceFileSizeReviewArtifact(runDirPath, review);
  return formatSevereSourceFileSizeOutput(review);
}
