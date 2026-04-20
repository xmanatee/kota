import { describe, expect, it } from "vitest";
import type { ResourceProfile } from "./fixture-run.js";
import { DEFAULT_NOISE_BAND_PP, evaluateRegressionGate } from "./noise-band.js";
import type { AggregateScore } from "./scoring.js";

const profileA: ResourceProfile = {
  cpuAllocationCores: 4,
  cpuKillThresholdCores: 4,
  memoryAllocationMB: 16_000,
  memoryKillThresholdMB: 16_000,
  hostClass: "ci-standard-4x16",
};

const profileB: ResourceProfile = {
  ...profileA,
  cpuKillThresholdCores: 2,
};

function score(passAtK: number, passHatK: number, repeatCount = 5): AggregateScore {
  return { fixtureCount: 10, repeatCount, passAtK, passHatK };
}

describe("evaluateRegressionGate", () => {
  it("does not gate when pass^k drop fits inside the noise band", () => {
    const decision = evaluateRegressionGate({
      baseline: score(0.9, 0.8),
      candidate: score(0.9, 0.78),
      baselineResourceProfile: profileA,
      candidateResourceProfile: profileA,
      noiseBandPercentagePoints: DEFAULT_NOISE_BAND_PP,
    });
    expect(decision).toMatchObject({
      status: "not-gated",
      reason: "within-noise-band",
    });
    expect(decision.dropPercentagePoints).toBeCloseTo(2, 5);
  });

  it("does not gate when the resource profile drifted, even on a large drop", () => {
    const decision = evaluateRegressionGate({
      baseline: score(0.95, 0.9),
      candidate: score(0.8, 0.5),
      baselineResourceProfile: profileA,
      candidateResourceProfile: profileB,
      noiseBandPercentagePoints: DEFAULT_NOISE_BAND_PP,
    });
    expect(decision.status).toBe("not-gated");
    expect(decision.reason).toBe("resource-profile-drift");
  });

  it("does not gate when candidate improved consistency", () => {
    const decision = evaluateRegressionGate({
      baseline: score(0.9, 0.7),
      candidate: score(0.9, 0.85),
      baselineResourceProfile: profileA,
      candidateResourceProfile: profileA,
      noiseBandPercentagePoints: DEFAULT_NOISE_BAND_PP,
    });
    expect(decision.status).toBe("not-gated");
    expect(decision.reason).toBe("pass-hat-k-improved");
  });

  it("does not gate when the two runs used different repeat counts", () => {
    const decision = evaluateRegressionGate({
      baseline: score(0.95, 0.9, 5),
      candidate: score(0.6, 0.4, 3),
      baselineResourceProfile: profileA,
      candidateResourceProfile: profileA,
      noiseBandPercentagePoints: DEFAULT_NOISE_BAND_PP,
    });
    expect(decision.status).toBe("not-gated");
    expect(decision.reason).toBe("repeat-count-mismatch");
  });

  it("gates when pass^k drops beyond the noise band on a stable resource profile", () => {
    const decision = evaluateRegressionGate({
      baseline: score(0.95, 0.9),
      candidate: score(0.9, 0.7),
      baselineResourceProfile: profileA,
      candidateResourceProfile: profileA,
      noiseBandPercentagePoints: DEFAULT_NOISE_BAND_PP,
    });
    expect(decision.status).toBe("gated");
    expect(decision.dropPercentagePoints).toBeCloseTo(20, 5);
    if (decision.status !== "gated") throw new Error("unreachable");
    expect(decision.reason).toContain("pass^k dropped");
    expect(decision.reason).toContain("ci-standard-4x16");
  });

  it("refuses to gate when k is below the minimum repeat count, even on a 100pp drop", () => {
    const decision = evaluateRegressionGate({
      baseline: score(1, 1, 1),
      candidate: score(0, 0, 1),
      baselineResourceProfile: profileA,
      candidateResourceProfile: profileA,
      noiseBandPercentagePoints: DEFAULT_NOISE_BAND_PP,
    });
    expect(decision.status).toBe("not-gated");
    expect(decision.reason).toBe("repeat-count-below-minimum");
    expect(decision.dropPercentagePoints).toBeCloseTo(100, 5);
  });
});
