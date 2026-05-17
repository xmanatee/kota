import { describe, expect, it } from "vitest";
import type { FixtureRun } from "./fixture-run.js";
import {
  FixtureConfigurationScoringError,
  scoreFixtureSet,
  scorePerFixture,
} from "./scoring.js";

const BASE_RUN: FixtureRun = {
  fixtureId: "fixture-a",
  runIndex: 0,
  repeatCount: 1,
  outcome: "pass",
  resourceProfile: {
    cpuAllocationCores: 2,
    cpuKillThresholdCores: 2,
    memoryAllocationMB: 4000,
    memoryKillThresholdMB: 4000,
    hostClass: "test",
  },
  timing: {
    startedAt: "2026-05-17T00:00:00.000Z",
    durationMs: 10,
    budgetMs: 60_000,
  },
  runArtifactPath: "/tmp/fixture-a-0",
};

describe("scoreFixtureSet", () => {
  it("computes pass@k and pass^k from capability outcomes", () => {
    const aggregate = scoreFixtureSet([
      BASE_RUN,
      {
        ...BASE_RUN,
        fixtureId: "fixture-b",
        outcome: "fail",
        runArtifactPath: "/tmp/fixture-b-0",
      },
    ]);
    expect(aggregate.fixtureCount).toBe(2);
    expect(aggregate.passAtK).toBe(0.5);
    expect(aggregate.passHatK).toBe(0.5);
  });
});

describe("scorePerFixture", () => {
  it("rejects configuration-error runs instead of counting them as capability scores", () => {
    expect(() =>
      scorePerFixture([
        {
          ...BASE_RUN,
          outcome: "configuration-error",
        },
      ]),
    ).toThrow(FixtureConfigurationScoringError);
  });
});
