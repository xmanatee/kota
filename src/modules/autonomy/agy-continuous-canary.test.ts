import { describe, expect, it } from "vitest";
import {
  type AgyCanaryObservation,
  assessAgyCanary,
  baselineCarriedAgyRunIds,
  parseAgyCanaryQualityReview,
  partitionAgyCanaryReviewRuns,
  partitionAgyCanaryRuns,
} from "./agy-continuous-canary.js";

function observation(
  overrides: Partial<AgyCanaryObservation> = {},
): AgyCanaryObservation {
  return {
    startedAt: "2026-09-01T00:00:00.000Z",
    observedAt: "2026-09-01T06:00:00.000Z",
    trigger: "window-elapsed",
    metrics: {
      agentRuns: 2,
      activeAgentRuns: 0,
      pendingReviewRuns: 0,
      preservedAgentRuns: 1,
      dispatchableTasks: 3,
      usefulCompletions: 2,
      failedRuns: 1,
      retriedRuns: 1,
      providerBackoffMs: 3_600_000,
      reviewRuns: 2,
      usefulReviews: 1,
      instructionChecks: 2,
      instructionFailures: 0,
      unrelatedChangedPaths: 0,
      cleanupFailures: 0,
      successfulEmptyResults: 0,
      rushedWorkFindings: 0,
      shallowVerificationFindings: 0,
      generatedDebrisPaths: 0,
    },
    sampledEvidence: ["run:builder-1"],
    diffScopeEvidence: ["artifact:diff-1"],
    providerIncidents: [],
    minorFindings: [
      {
        fingerprint: "same",
        title: "Investigate duplicate wording",
        description: "The review timed out before checking cleanup evidence.",
        evidenceRef: "artifact:run-1",
      },
    ],
    ...overrides,
  };
}

describe("AGY continuous canary", () => {
  it("carries preserved agent work that is already waiting at baseline", () => {
    expect(baselineCarriedAgyRunIds(
      [
        { id: "waiting-agent", workflow: "builder", status: "waiting" },
        { id: "running-agent", workflow: "reviewer", status: "running" },
        { id: "settled-agent", workflow: "builder", status: "success" },
        { id: "deterministic", workflow: "dispatcher", status: "waiting" },
      ],
      new Set(["builder", "reviewer"]),
    )).toEqual(["waiting-agent", "running-agent"]);
  });

  it("carries runs that settle after an observation boundary", () => {
    const afterBoundary = {
      id: "run-crossing-boundary",
      status: "success",
      completedAt: "2026-09-01T03:00:00.001Z",
    };
    const active = { id: "run-active", status: "running" };
    const settled = {
      id: "run-settled",
      status: "failed",
      completedAt: "2026-09-01T02:59:59.999Z",
    };

    expect(partitionAgyCanaryRuns(
      [afterBoundary, active, settled],
      "2026-09-01T03:00:00.000Z",
    )).toEqual({
      settled: [settled],
      carried: [afterBoundary, active],
    });
    expect(partitionAgyCanaryRuns(
      [afterBoundary],
      "2026-09-01T09:00:00.000Z",
    )).toEqual({ settled: [afterBoundary], carried: [] });
  });

  it("retains settled runs until an incident-blocked quality review completes", () => {
    const settled = {
      id: "run-settled",
      status: "success",
      completedAt: "2026-09-01T02:00:00.000Z",
    };
    const active = {
      id: "run-active",
      status: "running",
    };

    expect(partitionAgyCanaryReviewRuns(
      [settled, active],
      "2026-09-01T03:00:00.000Z",
      true,
    )).toEqual({
      reviewed: [],
      active: [active],
      pendingReview: [settled],
      carried: [active, settled],
    });
    expect(partitionAgyCanaryReviewRuns(
      [settled],
      "2026-09-01T09:00:00.000Z",
      false,
    )).toEqual({
      reviewed: [settled],
      active: [],
      pendingReview: [],
      carried: [],
    });
  });

  it("quantifies a six-hour productive window and deduplicates minor findings", () => {
    const result = assessAgyCanary("six-hour", observation());

    expect(result.decision).toEqual({
      kind: "continue",
      reasons: ["no-material-regression"],
    });
    expect(result.metrics.providerBackoffRatio).toBeCloseTo(1 / 6);
    expect(result.metrics.reviewYield).toBe(0.5);
    expect(result.metrics.instructionAdherence).toBe(1);
    expect(result.minorFindings).toEqual([
      {
        fingerprint: "same",
        title: "Investigate duplicate wording",
        description: "The review timed out before checking cleanup evidence.",
        evidenceRef: "artifact:run-1",
      },
    ]);
  });

  it("parks on reset evidence without turning quota into a quality failure", () => {
    const result = assessAgyCanary(
      "three-hour",
      observation({
        observedAt: "2026-09-01T03:00:00.000Z",
        providerIncidents: [{
          fingerprint: "quota-1",
          kind: "rate_limit",
          observations: 4,
          active: true,
          resetAt: "2026-09-01T04:00:00.000Z",
        }],
      }),
    );

    expect(result.decision).toEqual({
      kind: "park-provider",
      reasons: ["active-provider-quota-incident"],
      resetAt: "2026-09-01T04:00:00.000Z",
    });
  });

  it("parks an active quota incident when reviewer dispatch is suppressed", () => {
    const base = observation();
    const result = assessAgyCanary(
      "three-hour",
      observation({
        observedAt: "2026-09-01T03:00:00.000Z",
        metrics: {
          ...base.metrics,
          agentRuns: 3,
          usefulCompletions: 0,
          instructionChecks: 0,
        },
        providerIncidents: [{
          fingerprint: "quota-1",
          kind: "rate_limit",
          observations: 1,
          active: true,
          resetAt: "2026-09-01T04:00:00.000Z",
        }],
      }),
    );

    expect(result.decision).toEqual({
      kind: "park-provider",
      reasons: ["active-provider-quota-incident"],
      resetAt: "2026-09-01T04:00:00.000Z",
    });
    expect(result.metrics.instructionAdherence).toBeNull();
  });

  it("pauses repeated successful-empty output before more builders dispatch", () => {
    const base = observation();
    const result = assessAgyCanary(
      "six-hour",
      observation({
        metrics: {
          ...base.metrics,
          agentRuns: 3,
          instructionChecks: 3,
          usefulCompletions: 1,
          successfulEmptyResults: 2,
        },
      }),
    );

    expect(result.decision).toEqual({
      kind: "pause-quality",
      reasons: ["repeated-successful-empty-results"],
    });
  });

  it("pauses while an output-contract provider incident remains active", () => {
    const result = assessAgyCanary(
      "six-hour",
      observation({
        providerIncidents: [{
          fingerprint: "empty-output-1",
          kind: "output_contract",
          observations: 2,
          active: true,
        }],
      }),
    );

    expect(result.decision).toEqual({
      kind: "pause-quality",
      reasons: ["active-output-contract-incident"],
    });
  });

  it("pauses when remaining work sees dominant failures, retries, and provider backoff", () => {
    const base = observation();
    const result = assessAgyCanary(
      "six-hour",
      observation({
        metrics: {
          ...base.metrics,
          agentRuns: 12,
          instructionChecks: 12,
          preservedAgentRuns: 2,
          dispatchableTasks: 4,
          usefulCompletions: 1,
          failedRuns: 6,
          retriedRuns: 4,
          providerBackoffMs: 4 * 60 * 60 * 1000,
        },
      }),
    );

    expect(result.decision).toEqual({
      kind: "pause-quality",
      reasons: [
        "material-failure-retry-pressure",
        "excessive-provider-backoff",
      ],
    });
    expect(result.metrics.providerBackoffRatio).toBeCloseTo(2 / 3);
  });

  it("treats rushed work, shallow verification, and generated debris as material", () => {
    const base = observation();
    const result = assessAgyCanary(
      "six-hour",
      observation({
        metrics: {
          ...base.metrics,
          rushedWorkFindings: 1,
          shallowVerificationFindings: 1,
          generatedDebrisPaths: 2,
        },
      }),
    );

    expect(result.decision).toEqual({
      kind: "pause-quality",
      reasons: ["rushed-work", "shallow-verification", "generated-debris"],
    });
  });

  it("rejects a canary window before its observation boundary", () => {
    expect(() =>
      assessAgyCanary(
        "six-hour",
        observation({
          observedAt: "2026-09-01T05:59:59.999Z",
        }),
      )
    ).toThrow("six-hour observation is early");
  });

  it("rejects a completed window without collected agent-run evidence", () => {
    const base = observation();

    expect(() =>
      assessAgyCanary(
        "six-hour",
        observation({
          metrics: {
            ...base.metrics,
            agentRuns: 0,
            instructionChecks: 0,
          },
          sampledEvidence: [],
        }),
      )
    ).toThrow(
      "six-hour observation contains neither AGY agent-run nor provider-incident evidence",
    );
  });

  it("keeps a canonical quality incident paused at the next observation", () => {
    const result = assessAgyCanary(
      "six-hour",
      observation({
        activeQualityIncident: {
          reason: "unrelated edits",
          updatedAt: "2026-09-01T05:00:00.000Z",
        },
      }),
    );

    expect(result.decision).toEqual({
      kind: "pause-quality",
      reasons: ["active-quality-incident"],
    });
  });

  it("requires a grounded quality review for every observed run", () => {
    const evidence = new Map([
      ["run-1", new Set(["artifact:.kota/runs/run-1/metadata.json"])],
      ["run-2", new Set(["artifact:.kota/runs/run-2/metadata.json"])],
    ]);

    expect(() =>
      parseAgyCanaryQualityReview(
        JSON.stringify({
          runs: [{
            runId: "run-1",
            useful: true,
            instructionAdherent: true,
            cleanupHealthy: true,
            rushedWork: false,
            shallowVerification: false,
            unrelatedChangedPaths: [],
            generatedDebrisPaths: [],
            evidenceRefs: ["artifact:.kota/runs/run-1/metadata.json"],
          }],
          minorFindings: [],
        }),
        evidence,
      )
    ).toThrow("omitted observed run(s): run-2");
  });

  it("rejects fabricated quality-review citations", () => {
    const evidence = new Map([
      ["run-1", new Set(["artifact:.kota/runs/run-1/metadata.json"])],
    ]);

    expect(() =>
      parseAgyCanaryQualityReview(
        JSON.stringify({
          runs: [{
            runId: "run-1",
            useful: true,
            instructionAdherent: true,
            cleanupHealthy: true,
            rushedWork: false,
            shallowVerification: false,
            unrelatedChangedPaths: [],
            generatedDebrisPaths: [],
            evidenceRefs: ["artifact:fabricated.json"],
          }],
          minorFindings: [],
        }),
        evidence,
      )
    ).toThrow("cites uncollected evidence");
  });

  it("requires the reviewer to inspect every collected artifact for a run", () => {
    const evidence = new Map([
      [
        "run-1",
        new Set([
          "artifact:.kota/runs/run-1/metadata.json",
          "artifact:.kota/runs/run-1/writer-integration.json",
        ]),
      ],
    ]);

    expect(() =>
      parseAgyCanaryQualityReview(
        JSON.stringify({
          runs: [{
            runId: "run-1",
            useful: true,
            instructionAdherent: true,
            cleanupHealthy: true,
            rushedWork: false,
            shallowVerification: false,
            unrelatedChangedPaths: [],
            generatedDebrisPaths: [],
            evidenceRefs: ["artifact:.kota/runs/run-1/metadata.json"],
          }],
          minorFindings: [],
        }),
        evidence,
      )
    ).toThrow("omitted collected evidence");
  });
});
