import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunOutcomeAggregation } from "#modules/autonomy/run-outcome-aggregation.js";
import {
  decideImproverEvidenceGate,
  fingerprintImproverEvidence,
  readImproverEvidenceGateState,
  writeImproverEvidenceGateState,
} from "./evidence-gate.js";

function emptyAggregation(): RunOutcomeAggregation {
  return {
    failureRates24h: [],
    failureRates7d: [],
    topRepairFailures24h: [],
    topRepairFailures7d: [],
    durationOutliers: [],
  };
}

describe("improver evidence gate", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-improver-evidence-gate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("skips when recent aggregates contain no actionable signal", () => {
    const decision = decideImproverEvidenceGate(emptyAggregation(), null);
    expect(decision).toEqual({
      shouldRun: false,
      reason: "no recent actionable run evidence",
    });
    expect(fingerprintImproverEvidence(emptyAggregation())).toBeUndefined();
  });

  it("runs for new recent failure evidence", () => {
    const aggregation = emptyAggregation();
    aggregation.failureRates24h = [
      { workflow: "builder", total: 3, failures: 1, rate: 1 / 3 },
    ];

    const decision = decideImproverEvidenceGate(aggregation, null);
    expect(decision.shouldRun).toBe(true);
    expect(decision.reason).toBe("new actionable run evidence");
    expect(decision.actionableFingerprint).toBeTruthy();
  });

  it("skips unchanged evidence after a completed improver pass records it", () => {
    const aggregation = emptyAggregation();
    aggregation.topRepairFailures24h = [
      { checkId: "lint", count: 2, recovered: 2, terminal: 0 },
    ];
    const first = decideImproverEvidenceGate(aggregation, null);
    writeImproverEvidenceGateState(projectDir, first);

    const state = readImproverEvidenceGateState(projectDir);
    const second = decideImproverEvidenceGate(aggregation, state);

    expect(second.shouldRun).toBe(false);
    expect(second.reason).toBe(
      "actionable run evidence unchanged since the last completed improver pass",
    );
  });
});
