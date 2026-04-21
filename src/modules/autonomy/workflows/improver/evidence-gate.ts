import { join } from "node:path";
import { JsonFileError, readOptionalJsonFile, writeJsonFileAtomic } from "#core/util/json-file.js";
import type { RunOutcomeAggregation } from "#modules/autonomy/run-outcome-aggregation.js";

const STATE_FILE = "improver-evidence-gate.json";

type EvidenceGateState = {
  latestActionableRunAt: string;
  updatedAt: string;
  reason: string;
};

export type ImproverEvidenceGateDecision = {
  shouldRun: boolean;
  reason: string;
  latestActionableRunAt?: string;
};

function statePath(projectDir: string): string {
  return join(projectDir, ".kota", STATE_FILE);
}

function isEvidenceGateState(value: unknown): value is EvidenceGateState {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as EvidenceGateState).latestActionableRunAt === "string" &&
    typeof (value as EvidenceGateState).updatedAt === "string" &&
    typeof (value as EvidenceGateState).reason === "string"
  );
}

export function readImproverEvidenceGateState(
  projectDir: string,
): EvidenceGateState | null {
  const path = statePath(projectDir);
  const state = readOptionalJsonFile<unknown>(path);
  if (state === null) return null;
  if (!isEvidenceGateState(state)) {
    throw new JsonFileError(path, "parse", "invalid improver evidence gate state");
  }
  return state;
}

export function decideImproverEvidenceGate(
  aggregation: RunOutcomeAggregation,
  state: EvidenceGateState | null,
): ImproverEvidenceGateDecision {
  const { latestActionableRunAt } = aggregation;
  if (latestActionableRunAt === null) {
    return {
      shouldRun: false,
      reason: "no recent actionable run evidence",
    };
  }
  if (state && latestActionableRunAt <= state.latestActionableRunAt) {
    return {
      shouldRun: false,
      reason: "no new actionable run evidence since the last improver pass",
      latestActionableRunAt,
    };
  }
  return {
    shouldRun: true,
    reason: "new actionable run evidence",
    latestActionableRunAt,
  };
}

export function writeImproverEvidenceGateState(
  projectDir: string,
  decision: ImproverEvidenceGateDecision,
): void {
  if (!decision.latestActionableRunAt) {
    throw new Error(
      "Cannot record improver evidence gate state without a latestActionableRunAt",
    );
  }
  writeJsonFileAtomic(statePath(projectDir), {
    latestActionableRunAt: decision.latestActionableRunAt,
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
