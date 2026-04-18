import { createHash } from "node:crypto";
import { join } from "node:path";
import { JsonFileError, readOptionalJsonFile, writeJsonFileAtomic } from "#core/util/json-file.js";
import type { RunOutcomeAggregation } from "#modules/autonomy/run-outcome-aggregation.js";

const STATE_FILE = "improver-evidence-gate.json";

type EvidenceGateState = {
  lastActionableFingerprint: string;
  updatedAt: string;
  reason: string;
};

export type ImproverEvidenceGateDecision = {
  shouldRun: boolean;
  reason: string;
  actionableFingerprint?: string;
};

type ActionableSignals = {
  failures24h: Array<{ workflow: string; total: number; failures: number }>;
  repairFailures24h: Array<{
    workflow: string;
    checkId: string;
    count: number;
    recovered: number;
    terminal: number;
  }>;
  durationOutliers: Array<{ runId: string; workflow: string; durationMs: number; medianMs: number }>;
};

function statePath(projectDir: string): string {
  return join(projectDir, ".kota", STATE_FILE);
}

function isEvidenceGateState(value: unknown): value is EvidenceGateState {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as EvidenceGateState).lastActionableFingerprint === "string" &&
    typeof (value as EvidenceGateState).updatedAt === "string" &&
    typeof (value as EvidenceGateState).reason === "string"
  );
}

function actionableSignals(aggregation: RunOutcomeAggregation): ActionableSignals {
  return {
    failures24h: aggregation.failureRates24h
      .filter((entry) => entry.workflow !== "improver" && entry.failures > 0)
      .map(({ workflow, total, failures }) => ({ workflow, total, failures })),
    repairFailures24h: aggregation.topRepairFailures24h
      .filter(
        (entry) =>
          entry.workflow !== "improver" && (entry.terminal > 0 || entry.count >= 2),
      )
      .map(({ workflow, checkId, count, recovered, terminal }) => ({
        workflow,
        checkId,
        count,
        recovered,
        terminal,
      })),
    durationOutliers: aggregation.durationOutliers
      .filter((entry) => entry.workflow !== "improver")
      .map(({ runId, workflow, durationMs, medianMs }) => ({
        runId,
        workflow,
        durationMs,
        medianMs,
      })),
  };
}

function hasActionableSignals(signals: ActionableSignals): boolean {
  return (
    signals.failures24h.length > 0 ||
    signals.repairFailures24h.length > 0 ||
    signals.durationOutliers.length > 0
  );
}

export function fingerprintImproverEvidence(
  aggregation: RunOutcomeAggregation,
): string | undefined {
  const signals = actionableSignals(aggregation);
  if (!hasActionableSignals(signals)) return undefined;
  return createHash("sha256")
    .update(JSON.stringify(signals))
    .digest("hex");
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
  const actionableFingerprint = fingerprintImproverEvidence(aggregation);
  if (!actionableFingerprint) {
    return {
      shouldRun: false,
      reason: "no recent actionable run evidence",
    };
  }
  if (state?.lastActionableFingerprint === actionableFingerprint) {
    return {
      shouldRun: false,
      reason: "actionable run evidence unchanged since the last completed improver pass",
      actionableFingerprint,
    };
  }
  return {
    shouldRun: true,
    reason: "new actionable run evidence",
    actionableFingerprint,
  };
}

export function writeImproverEvidenceGateState(
  projectDir: string,
  decision: ImproverEvidenceGateDecision,
): void {
  if (!decision.actionableFingerprint) {
    throw new Error("Cannot record improver evidence gate state without an actionable fingerprint");
  }
  writeJsonFileAtomic(statePath(projectDir), {
    lastActionableFingerprint: decision.actionableFingerprint,
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
