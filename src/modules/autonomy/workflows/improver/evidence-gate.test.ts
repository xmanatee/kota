import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunOutcomeAggregation } from "#modules/autonomy/run-outcome-aggregation.js";
import {
  decideImproverEvidenceGate,
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
    latestActionableRunAt: null,
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

  it("skips when no actionable run completed in the window", () => {
    const decision = decideImproverEvidenceGate(emptyAggregation(), null);
    expect(decision).toEqual({
      shouldRun: false,
      reason: "no recent actionable run evidence",
    });
  });

  it("runs on first-seen actionable evidence", () => {
    const aggregation = emptyAggregation();
    aggregation.latestActionableRunAt = "2026-04-21T01:00:00.000Z";
    const decision = decideImproverEvidenceGate(aggregation, null);
    expect(decision.shouldRun).toBe(true);
    expect(decision.reason).toBe("new actionable run evidence");
    expect(decision.latestActionableRunAt).toBe("2026-04-21T01:00:00.000Z");
  });

  it("skips when the latest actionable run has not advanced since the last pass", () => {
    const aggregation = emptyAggregation();
    aggregation.latestActionableRunAt = "2026-04-21T01:00:00.000Z";
    const first = decideImproverEvidenceGate(aggregation, null);
    writeImproverEvidenceGateState(projectDir, first);

    const state = readImproverEvidenceGateState(projectDir);
    const second = decideImproverEvidenceGate(aggregation, state);

    expect(second.shouldRun).toBe(false);
    expect(second.reason).toBe(
      "no new actionable run evidence since the last improver pass",
    );
  });

  it("skips when older actionable runs aged out but no new run arrived", () => {
    // Regression guard for the bug that motivated this gate redesign:
    // raw-count fingerprints shifted whenever an old failure-bearing run
    // aged out of the 24h window, firing a ~$2.50 no-op improver pass.
    const beforeAging = emptyAggregation();
    beforeAging.latestActionableRunAt = "2026-04-21T01:00:00.000Z";
    const firstDecision = decideImproverEvidenceGate(beforeAging, null);
    writeImproverEvidenceGateState(projectDir, firstDecision);

    // Later: the max-actionable run aged out and earlier ones are now the
    // newest actionable evidence; timestamp does not advance.
    const afterAging = emptyAggregation();
    afterAging.latestActionableRunAt = "2026-04-20T22:00:00.000Z";
    const state = readImproverEvidenceGateState(projectDir);
    const secondDecision = decideImproverEvidenceGate(afterAging, state);

    expect(secondDecision.shouldRun).toBe(false);
    expect(secondDecision.reason).toBe(
      "no new actionable run evidence since the last improver pass",
    );
  });

  it("runs when a newer actionable run appears", () => {
    const first = emptyAggregation();
    first.latestActionableRunAt = "2026-04-21T01:00:00.000Z";
    writeImproverEvidenceGateState(
      projectDir,
      decideImproverEvidenceGate(first, null),
    );

    const next = emptyAggregation();
    next.latestActionableRunAt = "2026-04-21T02:30:00.000Z";
    const decision = decideImproverEvidenceGate(
      next,
      readImproverEvidenceGateState(projectDir),
    );
    expect(decision.shouldRun).toBe(true);
    expect(decision.latestActionableRunAt).toBe("2026-04-21T02:30:00.000Z");
  });

  it("discards invalid persisted gate state instead of bricking the improver", () => {
    const statePath = join(projectDir, ".kota", "improver-evidence-gate.json");
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({
        lastActionableFingerprint: "old-state-shape",
        updatedAt: "2026-04-21T02:45:45.241Z",
        reason: "old gate state",
      }),
      "utf8",
    );

    expect(readImproverEvidenceGateState(projectDir)).toBeNull();
    expect(existsSync(statePath)).toBe(false);
  });
});
