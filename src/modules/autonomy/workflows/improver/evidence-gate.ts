import { rmSync } from "node:fs";
import { join } from "node:path";
import { JsonFileError, readOptionalJsonFile, writeJsonFileAtomic } from "#core/util/json-file.js";
import type { AutonomyHealthIssueEvidence } from "#modules/autonomy/health-issue-cards.js";
import type { RunOutcomeAggregation } from "#modules/autonomy/run-outcome-aggregation.js";

const STATE_FILE = "improver-evidence-gate.json";

type EvidenceGateState = {
  latestActionableRunAt: string | null;
  latestHealthReviewAt: string | null;
  updatedAt: string;
  reason: string;
};

export type ImproverEvidenceGateDecision = {
  shouldRun: boolean;
  reason: string;
  latestActionableRunAt?: string;
  latestHealthReviewAt?: string;
};

function statePath(projectDir: string): string {
  return join(projectDir, ".kota", STATE_FILE);
}

function isEvidenceGateState(value: unknown): value is EvidenceGateState {
  const candidate = value as Partial<EvidenceGateState>;
  const latestActionableRunAt = candidate.latestActionableRunAt;
  const latestHealthReviewAt = candidate.latestHealthReviewAt;
  const carriesRecognizedTimestamp =
    Object.hasOwn(candidate, "latestActionableRunAt") ||
    Object.hasOwn(candidate, "latestHealthReviewAt");
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    carriesRecognizedTimestamp &&
    (latestActionableRunAt === null ||
      latestActionableRunAt === undefined ||
      typeof latestActionableRunAt === "string") &&
    (latestHealthReviewAt === null ||
      latestHealthReviewAt === undefined ||
      typeof latestHealthReviewAt === "string") &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.reason === "string"
  );
}

function discardInvalidEvidenceGateState(path: string): null {
  rmSync(path, { force: true });
  return null;
}

export function readImproverEvidenceGateState(
  projectDir: string,
): EvidenceGateState | null {
  const path = statePath(projectDir);
  let state: unknown;
  try {
    state = readOptionalJsonFile<unknown>(path);
  } catch (error) {
    if (error instanceof JsonFileError && error.operation === "parse") {
      return discardInvalidEvidenceGateState(path);
    }
    throw error;
  }
  if (state === null) return null;
  if (!isEvidenceGateState(state)) {
    return discardInvalidEvidenceGateState(path);
  }
  return state;
}

export function decideImproverEvidenceGate(
  aggregation: RunOutcomeAggregation,
  state: EvidenceGateState | null,
  healthEvidence?: AutonomyHealthIssueEvidence,
): ImproverEvidenceGateDecision {
  const { latestActionableRunAt } = aggregation;
  const latestHealthReviewAt =
    healthEvidence && healthEvidence.issueCards.length > 0
      ? healthEvidence.latestHealthReviewAt
      : null;
  if (latestActionableRunAt === null && latestHealthReviewAt === null) {
    return {
      shouldRun: false,
      reason: healthEvidence
        ? "no recent actionable run or health signal evidence"
        : "no recent actionable run evidence",
    };
  }

  const latestStateActionableRunAt = state?.latestActionableRunAt ?? null;
  const latestStateHealthReviewAt = state?.latestHealthReviewAt ?? null;
  const actionableRunAdvanced =
    latestActionableRunAt !== null &&
    (latestStateActionableRunAt === null ||
      latestActionableRunAt > latestStateActionableRunAt);
  const healthReviewAdvanced =
    latestHealthReviewAt !== null &&
    (latestStateHealthReviewAt === null ||
      latestHealthReviewAt > latestStateHealthReviewAt);

  if (!actionableRunAdvanced && !healthReviewAdvanced) {
    return {
      shouldRun: false,
      reason: healthEvidence
        ? "no new actionable run or health signal evidence since the last improver pass"
        : "no new actionable run evidence since the last improver pass",
      ...(latestActionableRunAt ? { latestActionableRunAt } : {}),
      ...(latestHealthReviewAt ? { latestHealthReviewAt } : {}),
    };
  }

  if (healthReviewAdvanced && !actionableRunAdvanced) {
    return {
      shouldRun: true,
      reason: "new systemic health signal evidence",
      ...(latestActionableRunAt ? { latestActionableRunAt } : {}),
      latestHealthReviewAt,
    };
  }

  return {
    shouldRun: true,
    reason: "new actionable run evidence",
    ...(latestActionableRunAt ? { latestActionableRunAt } : {}),
    ...(latestHealthReviewAt ? { latestHealthReviewAt } : {}),
  };
}

export function writeImproverEvidenceGateState(
  projectDir: string,
  decision: ImproverEvidenceGateDecision,
): void {
  if (!decision.latestActionableRunAt && !decision.latestHealthReviewAt) {
    throw new Error(
      "Cannot record improver evidence gate state without evidence timestamps",
    );
  }
  writeJsonFileAtomic(statePath(projectDir), {
    latestActionableRunAt: decision.latestActionableRunAt ?? null,
    latestHealthReviewAt: decision.latestHealthReviewAt ?? null,
    updatedAt: new Date().toISOString(),
    reason: decision.reason,
  });
}

export function shouldRunImproverFromGate(output: unknown): boolean {
  return (
    output !== null &&
    typeof output === "object" &&
    !Array.isArray(output) &&
    (output as ImproverEvidenceGateDecision).shouldRun === true
  );
}
