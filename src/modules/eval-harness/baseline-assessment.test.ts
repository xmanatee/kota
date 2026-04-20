import { describe, expect, it } from "vitest";
import {
  assessAgainstBaseline,
  type CandidateAssessment,
} from "./baseline-assessment.js";
import type { PersistedBaseline } from "./baseline-store.js";
import type { ResourceProfile } from "./fixture-run.js";

const stableProfile: ResourceProfile = {
  hostClass: "autonomy-cadence",
  cpuAllocationCores: 2,
  cpuKillThresholdCores: 2,
  memoryAllocationMB: 4096,
  memoryKillThresholdMB: 4096,
};

const driftedProfile: ResourceProfile = {
  ...stableProfile,
  cpuKillThresholdCores: 4,
};

function candidate(
  passHatK: number,
  passAtK: number,
  overrides: Partial<CandidateAssessment> = {},
): CandidateAssessment {
  return {
    aggregate: { fixtureCount: 4, repeatCount: 3, passAtK, passHatK },
    resourceProfile: stableProfile,
    runArtifactBaseDir: "/tmp/fresh/eval-runs",
    recordedAt: "2026-04-27T12:00:00.000Z",
    ...overrides,
  };
}

function baseline(passHatK: number, passAtK: number, k = 3): PersistedBaseline {
  return {
    aggregate: { fixtureCount: 4, repeatCount: k, passAtK, passHatK },
    resourceProfile: stableProfile,
    recordedAt: "2026-04-20T12:00:00.000Z",
    runArtifactBaseDir: "/tmp/prior/eval-runs",
  };
}

describe("assessAgainstBaseline", () => {
  it("first-run (no prior baseline) records the candidate but does not gate", () => {
    const result = assessAgainstBaseline(null, candidate(1, 1));
    expect(result.status).toBe("first-run");
    if (result.status !== "first-run") throw new Error("unreachable");
    expect(result.baselineToRecord.aggregate.passHatK).toBe(1);
    expect(result.baselineToRecord.recordedAt).toBe(
      "2026-04-27T12:00:00.000Z",
    );
  });

  it("gates on a pass^k drop beyond the noise band with a stable profile", () => {
    const result = assessAgainstBaseline(
      baseline(0.95, 0.95),
      candidate(0.7, 0.95),
    );
    expect(result.status).toBe("gated");
    if (result.status !== "gated") throw new Error("unreachable");
    expect(result.dropPercentagePoints).toBeCloseTo(25, 5);
    expect(result.reason).toContain("pass^k dropped");
    expect(result.priorBaseline.aggregate.passHatK).toBe(0.95);
  });

  it("rolls baseline forward on a not-gated outcome within the noise band", () => {
    const result = assessAgainstBaseline(
      baseline(0.95, 0.95),
      candidate(0.94, 0.95),
    );
    expect(result.status).toBe("not-gated");
    if (result.status !== "not-gated") throw new Error("unreachable");
    expect(result.reason).toBe("within-noise-band");
    expect(result.baselineToRecord.aggregate.passHatK).toBe(0.94);
    expect(result.baselineToRecord.recordedAt).toBe(
      "2026-04-27T12:00:00.000Z",
    );
  });

  it("resource-profile drift resolves to not-gated even on a large drop", () => {
    const result = assessAgainstBaseline(
      baseline(0.95, 0.95),
      candidate(0.4, 0.8, { resourceProfile: driftedProfile }),
    );
    expect(result.status).toBe("not-gated");
    if (result.status !== "not-gated") throw new Error("unreachable");
    expect(result.reason).toBe("resource-profile-drift");
    expect(result.baselineToRecord.resourceProfile).toEqual(driftedProfile);
  });

  it("repeat-count-below-minimum resolves to not-gated even on a 100pp drop", () => {
    const result = assessAgainstBaseline(
      baseline(1, 1, 2),
      candidate(0, 0, {
        aggregate: { fixtureCount: 4, repeatCount: 2, passAtK: 0, passHatK: 0 },
      }),
    );
    expect(result.status).toBe("not-gated");
    if (result.status !== "not-gated") throw new Error("unreachable");
    expect(result.reason).toBe("repeat-count-below-minimum");
  });

  it("passes the configured noise band through to the gate", () => {
    const result = assessAgainstBaseline(
      baseline(0.95, 0.95),
      candidate(0.9, 0.95, { noiseBandPercentagePoints: 10 }),
    );
    expect(result.status).toBe("not-gated");
    if (result.status !== "not-gated") throw new Error("unreachable");
    expect(result.reason).toBe("within-noise-band");
    expect(result.noiseBandPercentagePoints).toBe(10);
  });
});
