import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectObservabilityEvidence,
  detectObservabilityReasons,
  normalizeObservabilityPath,
} from "./observability-obligation-rules.js";
import {
  OBSERVABILITY_OBLIGATION_RATIONALE_ARTIFACT,
  OBSERVABILITY_OBLIGATION_REVIEW_ARTIFACT,
  OBSERVABILITY_OBLIGATION_WARNING_TYPE,
  type ObservabilityFollowUpTaskSeed,
  type ObservabilityObligationCandidate,
  type ObservabilityObligationReview,
} from "./observability-obligation-types.js";
import { parseAddedLinesByFile, readStagedDiff } from "./staged-diff.js";

export {
  OBSERVABILITY_OBLIGATION_RATIONALE_ARTIFACT,
  OBSERVABILITY_OBLIGATION_REVIEW_ARTIFACT,
  OBSERVABILITY_OBLIGATION_WARNING_TYPE,
  type ObservabilityEvidence,
  type ObservabilityEvidenceKind,
  type ObservabilityFollowUpTaskSeed,
  type ObservabilityObligationCandidate,
  type ObservabilityObligationReview,
  type ObservabilitySensitivityReason,
  type ObservabilitySensitivityReasonKind,
} from "./observability-obligation-types.js";

type ObservabilityRationaleEntry = {
  file: string;
  rationale: string;
};

type ObservabilityRationaleFile = {
  entries: ObservabilityRationaleEntry[];
};

function isRationaleEntry(entry: ObservabilityRationaleEntry): boolean {
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof entry.file === "string" &&
    entry.file.trim().length > 0 &&
    typeof entry.rationale === "string" &&
    entry.rationale.trim().length > 0
  );
}

function isRationaleFile(file: ObservabilityRationaleFile): boolean {
  return (
    typeof file === "object" &&
    file !== null &&
    Array.isArray(file.entries) &&
    file.entries.every(isRationaleEntry)
  );
}

function readRationaleByFile(runDirPath: string): Map<string, string> {
  const path = join(runDirPath, OBSERVABILITY_OBLIGATION_RATIONALE_ARTIFACT);
  if (!existsSync(path)) return new Map();
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as ObservabilityRationaleFile;
  if (!isRationaleFile(parsed)) {
    throw new Error(`Malformed ${OBSERVABILITY_OBLIGATION_RATIONALE_ARTIFACT}`);
  }
  return new Map(
    parsed.entries.map((entry) => [
      normalizeObservabilityPath(entry.file),
      entry.rationale.trim(),
    ]),
  );
}

function buildMessage(candidates: readonly ObservabilityObligationCandidate[]): string {
  if (candidates.length === 0) {
    return "OK: no staged production runtime-observability obligation candidates";
  }
  const missing = candidates.filter((candidate) => candidate.status === "missing");
  if (missing.length === 0) {
    return `OK: ${candidates.length} observability-sensitive candidate file(s) have inspectable evidence`;
  }
  return (
    `${missing.length} of ${candidates.length} observability-sensitive candidate file(s) ` +
    "lack structured logging, event, run-artifact, explicit error-result, test assertion, or rationale evidence"
  );
}

function buildFollowUpTask(
  missing: readonly ObservabilityObligationCandidate[],
): ObservabilityFollowUpTaskSeed | undefined {
  if (missing.length === 0) return undefined;
  return {
    title: "Add observability evidence for agent-authored runtime changes",
    summary:
      "The builder observability-obligation diagnostic found runtime-sensitive staged changes without inspectable diagnostic evidence.",
    candidateFiles: missing.map((candidate) => candidate.file),
    artifact: OBSERVABILITY_OBLIGATION_REVIEW_ARTIFACT,
  };
}

export function detectObservabilityObligationReview(
  diff: string,
  rationaleByFile: ReadonlyMap<string, string> = new Map(),
): ObservabilityObligationReview {
  const fileDiffs = parseAddedLinesByFile(diff);
  const candidates: ObservabilityObligationCandidate[] = [];
  for (const fileDiff of fileDiffs) {
    const file = normalizeObservabilityPath(fileDiff.file);
    const reasons = detectObservabilityReasons(fileDiff);
    if (reasons.length === 0) continue;
    const evidence = detectObservabilityEvidence(fileDiff, fileDiffs, rationaleByFile);
    const status = evidence.length > 0 ? "satisfied" : "missing";
    candidates.push({
      file,
      status,
      reasons,
      evidence,
      message:
        status === "satisfied"
          ? "Inspectable observability evidence found for this runtime-sensitive change."
          : "No inspectable observability evidence found for this runtime-sensitive change.",
    });
  }
  const missing = candidates.filter((candidate) => candidate.status === "missing");
  const satisfied = candidates.filter((candidate) => candidate.status === "satisfied");
  return {
    type: OBSERVABILITY_OBLIGATION_WARNING_TYPE,
    outcome: missing.length > 0 ? "warning" : "ok",
    candidates,
    satisfiedFiles: satisfied.map((candidate) => candidate.file),
    missingFiles: missing.map((candidate) => candidate.file),
    message: buildMessage(candidates),
    ...(missing.length > 0 ? { followUpTask: buildFollowUpTask(missing) } : {}),
  };
}

export function evaluateObservabilityObligationReview(
  projectDir: string,
  runDirPath: string,
): ObservabilityObligationReview {
  const diff = readStagedDiff(projectDir, ["."]);
  return detectObservabilityObligationReview(diff, readRationaleByFile(runDirPath));
}

export function formatObservabilityObligationReview(
  review: ObservabilityObligationReview,
): string {
  return JSON.stringify(review, null, 2);
}

function isReview(review: ObservabilityObligationReview): boolean {
  if (
    typeof review !== "object" ||
    review === null ||
    review.type !== OBSERVABILITY_OBLIGATION_WARNING_TYPE ||
    (review.outcome !== "ok" && review.outcome !== "warning") ||
    !Array.isArray(review.candidates) ||
    !Array.isArray(review.satisfiedFiles) ||
    !Array.isArray(review.missingFiles) ||
    typeof review.message !== "string"
  ) {
    return false;
  }
  return review.candidates.every(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      typeof candidate.file === "string" &&
      (candidate.status === "satisfied" || candidate.status === "missing") &&
      Array.isArray(candidate.reasons) &&
      Array.isArray(candidate.evidence) &&
      typeof candidate.message === "string",
  );
}

export function writeObservabilityObligationReviewArtifact(
  runDirPath: string,
  review: ObservabilityObligationReview,
): void {
  writeFileSync(
    join(runDirPath, OBSERVABILITY_OBLIGATION_REVIEW_ARTIFACT),
    `${formatObservabilityObligationReview(review)}\n`,
    "utf-8",
  );
}

export function readObservabilityObligationReviewArtifact(
  runDirPath: string,
): ObservabilityObligationReview | null {
  const path = join(runDirPath, OBSERVABILITY_OBLIGATION_REVIEW_ARTIFACT);
  if (!existsSync(path)) return null;
  const review = JSON.parse(readFileSync(path, "utf-8")) as ObservabilityObligationReview;
  if (!isReview(review)) {
    throw new Error(`Malformed ${OBSERVABILITY_OBLIGATION_REVIEW_ARTIFACT}`);
  }
  return review;
}

export function checkObservabilityObligationsForRun(
  projectDir: string,
  runDirPath: string,
): string {
  const review = evaluateObservabilityObligationReview(projectDir, runDirPath);
  writeObservabilityObligationReviewArtifact(runDirPath, review);
  if (review.outcome === "warning") {
    throw new Error(formatObservabilityObligationReview(review));
  }
  return review.message;
}
