import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { JsonFileError, readOptionalJsonFile, writeJsonFileAtomic } from "#core/util/json-file.js";
import type {
  AutonomyHealthIssueCard,
  AutonomyHealthIssueEvidence,
} from "#modules/autonomy/health-issue-cards.js";
import type { RunOutcomeAggregation } from "#modules/autonomy/run-outcome-aggregation.js";

const STATE_FILE = "improver-evidence-gate.json";

type EvidenceGateState = {
  latestActionableRunAt: string | null;
  latestIssueProjectionAt: string | null;
  latestHealthEvidenceFingerprint?: string | null;
  updatedAt: string;
  reason: string;
};

export type ImproverEvidenceGateDecision = {
  shouldRun: boolean;
  reason: string;
  latestActionableRunAt?: string;
  latestIssueProjectionAt?: string;
  latestHealthEvidenceFingerprint?: string;
};

function statePath(projectDir: string): string {
  return join(projectDir, ".kota", STATE_FILE);
}

function isEvidenceGateState(value: unknown): value is EvidenceGateState {
  const candidate = value as Partial<EvidenceGateState>;
  const latestActionableRunAt = candidate.latestActionableRunAt;
  const latestIssueProjectionAt = candidate.latestIssueProjectionAt;
  const latestHealthEvidenceFingerprint =
    candidate.latestHealthEvidenceFingerprint;
  const carriesRecognizedTimestamp =
    Object.hasOwn(candidate, "latestActionableRunAt") ||
    Object.hasOwn(candidate, "latestIssueProjectionAt");
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    carriesRecognizedTimestamp &&
    (latestActionableRunAt === null ||
      latestActionableRunAt === undefined ||
      typeof latestActionableRunAt === "string") &&
    (latestIssueProjectionAt === null ||
      latestIssueProjectionAt === undefined ||
      typeof latestIssueProjectionAt === "string") &&
    (latestHealthEvidenceFingerprint === null ||
      latestHealthEvidenceFingerprint === undefined ||
      typeof latestHealthEvidenceFingerprint === "string") &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.reason === "string"
  );
}

function discardInvalidEvidenceGateState(path: string): null {
  rmSync(path, { force: true });
  return null;
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function localCodeHealthIssueCards(
  healthEvidence: AutonomyHealthIssueEvidence | undefined,
): AutonomyHealthIssueCard[] {
  return (
    healthEvidence?.issueCards.filter((card) => card.actionability === "local-code") ??
    []
  );
}

function healthEvidenceFingerprint(
  healthEvidence: AutonomyHealthIssueEvidence | undefined,
): string | null {
  const cards = localCodeHealthIssueCards(healthEvidence);
  if (cards.length === 0) return null;
  const material = cards
    .map((card) => ({
      actionability: card.actionability,
      dedupeKey: card.dedupeKey,
      issueKey: card.issueKey,
      status: card.status,
      labels: [...card.labels].sort(compareStrings),
      severity: card.severity,
      semanticRevision: card.semanticRevision,
    }))
    .sort((left, right) => left.dedupeKey.localeCompare(right.dedupeKey));
  return createHash("sha256")
    .update(JSON.stringify(material))
    .digest("hex")
    .slice(0, 20);
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
  const latestHealthEvidenceFingerprint = healthEvidenceFingerprint(healthEvidence);
  const latestIssueProjectionAt =
    healthEvidence && latestHealthEvidenceFingerprint !== null
      ? healthEvidence.projectionUpdatedAt
      : null;
  if (latestActionableRunAt === null && latestIssueProjectionAt === null) {
    return {
      shouldRun: false,
      reason: healthEvidence
        ? "no recent actionable run or health signal evidence"
        : "no recent actionable run evidence",
    };
  }

  const latestStateActionableRunAt = state?.latestActionableRunAt ?? null;
  const latestStateIssueProjectionAt = state?.latestIssueProjectionAt ?? null;
  const latestStateHealthEvidenceFingerprint =
    state?.latestHealthEvidenceFingerprint ?? null;
  const actionableRunAdvanced =
    latestActionableRunAt !== null &&
    (latestStateActionableRunAt === null ||
      latestActionableRunAt > latestStateActionableRunAt);
  const issueProjectionTimestampAdvanced =
    latestIssueProjectionAt !== null &&
    (latestStateIssueProjectionAt === null ||
      latestIssueProjectionAt > latestStateIssueProjectionAt);
  const healthEvidenceChanged =
    latestHealthEvidenceFingerprint !== null &&
    (latestStateHealthEvidenceFingerprint === null ||
      latestHealthEvidenceFingerprint !== latestStateHealthEvidenceFingerprint);
  const healthReviewAdvanced =
    issueProjectionTimestampAdvanced && healthEvidenceChanged;

  if (!actionableRunAdvanced && !healthReviewAdvanced) {
    return {
      shouldRun: false,
      reason: healthEvidence
        ? "no new actionable run or health signal evidence since the last improver pass"
        : "no new actionable run evidence since the last improver pass",
      ...(latestActionableRunAt ? { latestActionableRunAt } : {}),
      ...(latestIssueProjectionAt ? { latestIssueProjectionAt } : {}),
      ...(latestHealthEvidenceFingerprint
        ? { latestHealthEvidenceFingerprint }
        : {}),
    };
  }

  if (healthReviewAdvanced && !actionableRunAdvanced) {
    return {
      shouldRun: true,
      reason: "new systemic health signal evidence",
      ...(latestActionableRunAt ? { latestActionableRunAt } : {}),
      latestIssueProjectionAt,
      ...(latestHealthEvidenceFingerprint
        ? { latestHealthEvidenceFingerprint }
        : {}),
    };
  }

  return {
    shouldRun: true,
    reason: "new actionable run evidence",
    ...(latestActionableRunAt ? { latestActionableRunAt } : {}),
    ...(latestIssueProjectionAt ? { latestIssueProjectionAt } : {}),
    ...(latestHealthEvidenceFingerprint
      ? { latestHealthEvidenceFingerprint }
      : {}),
  };
}

export function writeImproverEvidenceGateState(
  projectDir: string,
  decision: ImproverEvidenceGateDecision,
): void {
  if (!decision.latestActionableRunAt && !decision.latestIssueProjectionAt) {
    throw new Error(
      "Cannot record improver evidence gate state without evidence timestamps",
    );
  }
  writeJsonFileAtomic(statePath(projectDir), {
    latestActionableRunAt: decision.latestActionableRunAt ?? null,
    latestIssueProjectionAt: decision.latestIssueProjectionAt ?? null,
    latestHealthEvidenceFingerprint:
      decision.latestHealthEvidenceFingerprint ?? null,
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
