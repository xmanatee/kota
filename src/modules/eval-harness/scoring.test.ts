import { describe, expect, it } from "vitest";
import type { ExecutionProfilePreflightResult, FixtureRun } from "./fixture-run.js";
import {
  computeFixtureDiagnostics,
  FixtureConfigurationScoringError,
  scoreFixtureSet,
  scorePerFixture,
} from "./scoring.js";

const RESOURCE_PROFILE = {
  cpuAllocationCores: 2,
  cpuKillThresholdCores: 2,
  memoryAllocationMB: 4000,
  memoryKillThresholdMB: 4000,
  hostClass: "test",
};

const EXECUTION_PROFILE: ExecutionProfilePreflightResult = {
  status: "verified",
  backendKind: "container",
  requestedProfile: RESOURCE_PROFILE,
  observedOrEnforcedProfile: RESOURCE_PROFILE,
  verification: "enforced",
  gateEligible: true,
  eligibilityReason: "verified-profile",
  diagnostics: [],
};

const BASE_RUN: FixtureRun = {
  fixtureId: "fixture-a",
  runIndex: 0,
  repeatCount: 1,
  outcome: "pass",
  resourceProfile: RESOURCE_PROFILE,
  executionProfile: EXECUTION_PROFILE,
  objectiveMetrics: [],
  timing: {
    startedAt: "2026-05-17T00:00:00.000Z",
    durationMs: 10,
    budgetMs: 60_000,
  },
  runArtifactPath: "/tmp/fixture-a-0",
};

function run(
  fixtureId: string,
  runIndex: number,
  repeatCount: number,
  outcome: FixtureRun["outcome"],
): FixtureRun {
  return {
    ...BASE_RUN,
    fixtureId,
    runIndex,
    repeatCount,
    outcome,
    runArtifactPath: `/tmp/${fixtureId}-${runIndex}`,
  };
}

describe("scoreFixtureSet", () => {
  it("computes pass@k and pass^k from capability outcomes", () => {
    const aggregate = scoreFixtureSet([
      {
        ...BASE_RUN,
        objectiveMetrics: [
          {
            fixtureId: "fixture-a",
            name: "duration",
            unit: "ms",
            direction: "lower_is_better",
            source: { kind: "text-file", path: "metric.txt" },
            value: 3,
            runIndex: 0,
            repeatCount: 1,
            resourceProfile: RESOURCE_PROFILE,
            executionProfile: {
              status: "verified",
              backendKind: "container",
              verification: "enforced",
              gateEligible: true,
              reason: "verified-profile",
            },
          },
        ],
      },
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

  it("rejects calibration configuration failures from aggregate scoring", () => {
    expect(() =>
      scoreFixtureSet([
        {
          ...BASE_RUN,
          outcome: "configuration-error",
          runArtifactPath: "/tmp/calibration-failed-0",
        },
      ]),
    ).toThrow(FixtureConfigurationScoringError);
  });
});

describe("computeFixtureDiagnostics", () => {
  it("classifies stable pass, stable fail, and mixed repeat outcomes", () => {
    const report = computeFixtureDiagnostics([
      run("stable-pass", 0, 3, "pass"),
      run("stable-pass", 1, 3, "pass"),
      run("stable-pass", 2, 3, "pass"),
      run("stable-fail", 0, 3, "fail"),
      run("stable-fail", 1, 3, "fail"),
      run("stable-fail", 2, 3, "fail"),
      run("mixed", 0, 3, "pass"),
      run("mixed", 1, 3, "fail"),
      run("mixed", 2, 3, "timeout"),
    ]);

    expect(report.aggregate).toEqual({
      fixtureCount: 3,
      stablePass: 1,
      stableFail: 1,
      repeatUnstable: 1,
      insufficientSample: 0,
      nonGating: 0,
      lowSignalWarnings: 1,
    });
    expect(report.perFixture.map((diagnostic) => diagnostic.diagnosticClass)).toEqual([
      "stable-pass",
      "stable-fail",
      "repeat-unstable",
    ]);
    const mixed = report.perFixture.find((diagnostic) => diagnostic.fixtureId === "mixed");
    expect(mixed).toMatchObject({
      outcomes: ["pass", "fail", "timeout"],
      outcomeCounts: {
        pass: 1,
        fail: 1,
        timeout: 1,
        error: 0,
        "configuration-error": 0,
      },
      observedPassRate: 1 / 3,
      diagnosticClass: "repeat-unstable",
      warnings: ["low-signal-repeat-instability"],
    });
    expect(mixed?.repeatVariance).toBeCloseTo(2 / 9);
  });

  it("reports k=1 as insufficient sample rather than stable evidence", () => {
    const report = computeFixtureDiagnostics([run("single-pass", 0, 1, "pass")]);

    expect(report.aggregate).toEqual({
      fixtureCount: 1,
      stablePass: 0,
      stableFail: 0,
      repeatUnstable: 0,
      insufficientSample: 1,
      nonGating: 0,
      lowSignalWarnings: 0,
    });
    expect(report.perFixture[0]).toMatchObject({
      fixtureId: "single-pass",
      outcomes: ["pass"],
      observedPassRate: 1,
      repeatVariance: 0,
      diagnosticClass: "insufficient-sample",
      warnings: ["insufficient-sample"],
    });
  });
});
