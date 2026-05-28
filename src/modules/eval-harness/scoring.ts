/**
 * Scoring for autonomy eval-harness fixture runs.
 *
 * `pass@k` is the fraction of fixtures where at least one of the k runs
 * passed (capability — can the agent ever solve this?). `pass^k` is the
 * fraction of fixtures where all k runs passed (consistency — does the
 * agent solve this reliably?). The harness always reports both: averaging
 * them loses the distinction the Mar 2026 infrastructure-noise post warns
 * against.
 */

import type { FixtureRun, FixtureRunOutcome } from "./fixture-run.js";
import { MIN_REPEAT_COUNT_FOR_GATING } from "./noise-band.js";

export type FixtureScore = {
  fixtureId: string;
  repeatCount: number;
  passedAny: boolean;
  passedAll: boolean;
  observedPassRate: number;
};

export type FixtureOutcomeCounts = {
  pass: number;
  fail: number;
  timeout: number;
  error: number;
  "configuration-error": number;
};

export type FixtureDiagnosticClass =
  | "stable-pass"
  | "stable-fail"
  | "repeat-unstable"
  | "insufficient-sample";

export type FixtureDiagnosticWarning =
  | "insufficient-sample"
  | "low-signal-repeat-instability"
  | "non-gating-execution-profile";

export type FixtureDiagnostics = {
  fixtureId: string;
  repeatCount: number;
  outcomes: readonly FixtureRunOutcome[];
  outcomeCounts: FixtureOutcomeCounts;
  observedPassRate: number;
  /**
   * Population variance of binary pass outcomes across this repeat set.
   * Stable all-pass and all-fail fixtures report 0; mixed repeat outcomes
   * rise toward 0.25.
   */
  repeatVariance: number;
  diagnosticClass: FixtureDiagnosticClass;
  warnings: readonly FixtureDiagnosticWarning[];
};

export type FixtureDiagnosticAggregate = {
  fixtureCount: number;
  stablePass: number;
  stableFail: number;
  repeatUnstable: number;
  insufficientSample: number;
  nonGating: number;
  lowSignalWarnings: number;
};

export type FixtureDiagnosticsReport = {
  perFixture: readonly FixtureDiagnostics[];
  aggregate: FixtureDiagnosticAggregate;
};

export type AggregateScore = {
  fixtureCount: number;
  /** Common repeat count when every fixture used the same k; null when k varied. */
  repeatCount: number | null;
  /** Fraction of fixtures with at least one passing run. */
  passAtK: number;
  /** Fraction of fixtures where every run passed. */
  passHatK: number;
};

export class FixtureConfigurationScoringError extends Error {
  readonly fixtureId: string;
  readonly runIndex: number;

  constructor(run: FixtureRun) {
    super(
      `Fixture "${run.fixtureId}" runIndex ${run.runIndex} ended with configuration-error; fix the fixture before computing pass@k/pass^k.`,
    );
    this.name = "FixtureConfigurationScoringError";
    this.fixtureId = run.fixtureId;
    this.runIndex = run.runIndex;
  }
}

type FixtureRunGroup = {
  fixtureId: string;
  repeatCount: number;
  runs: FixtureRun[];
};

function emptyOutcomeCounts(): FixtureOutcomeCounts {
  return {
    pass: 0,
    fail: 0,
    timeout: 0,
    error: 0,
    "configuration-error": 0,
  };
}

/**
 * Group runs by fixtureId and validate complete repeat sets. A partial set
 * fails loudly rather than scoring or diagnosing a half-run as a flaky pass.
 */
function groupCompleteFixtureRuns(
  runs: readonly FixtureRun[],
): FixtureRunGroup[] {
  if (runs.length === 0) return [];
  const grouped = new Map<string, FixtureRun[]>();
  for (const run of runs) {
    if (run.outcome === "configuration-error") {
      throw new FixtureConfigurationScoringError(run);
    }
    const bucket = grouped.get(run.fixtureId);
    if (bucket) {
      bucket.push(run);
    } else {
      grouped.set(run.fixtureId, [run]);
    }
  }

  const groups: FixtureRunGroup[] = [];
  for (const [fixtureId, bucket] of grouped) {
    const repeatCount = bucket[0].repeatCount;
    if (bucket.length !== repeatCount) {
      throw new Error(
        `Fixture "${fixtureId}" has ${bucket.length} runs but repeatCount=${repeatCount}; expected a complete repeat set.`,
      );
    }
    const seenIndices = new Set<number>();
    for (const run of bucket) {
      if (run.repeatCount !== repeatCount) {
        throw new Error(
          `Fixture "${fixtureId}" has mixed repeatCount values (${run.repeatCount} vs ${repeatCount}).`,
        );
      }
      if (run.runIndex < 0 || run.runIndex >= repeatCount) {
        throw new Error(
          `Fixture "${fixtureId}" runIndex ${run.runIndex} outside [0, ${repeatCount}).`,
        );
      }
      if (seenIndices.has(run.runIndex)) {
        throw new Error(
          `Fixture "${fixtureId}" has duplicate runIndex ${run.runIndex}.`,
        );
      }
      seenIndices.add(run.runIndex);
    }

    groups.push({
      fixtureId,
      repeatCount,
      runs: [...bucket].sort((a, b) => a.runIndex - b.runIndex),
    });
  }

  return groups;
}

/**
 * Compute the pass@k/pass^k inputs per fixture from complete repeat sets.
 */
export function scorePerFixture(runs: readonly FixtureRun[]): FixtureScore[] {
  const scores: FixtureScore[] = [];
  for (const group of groupCompleteFixtureRuns(runs)) {
    const passes = group.runs.filter((r) => r.outcome === "pass").length;
    scores.push({
      fixtureId: group.fixtureId,
      repeatCount: group.repeatCount,
      passedAny: passes > 0,
      passedAll: passes === group.repeatCount,
      observedPassRate: passes / group.repeatCount,
    });
  }

  return scores;
}

export function diagnosticsPerFixture(
  runs: readonly FixtureRun[],
): FixtureDiagnostics[] {
  const diagnostics: FixtureDiagnostics[] = [];
  for (const group of groupCompleteFixtureRuns(runs)) {
    const outcomeCounts = emptyOutcomeCounts();
    const outcomes = group.runs.map((run) => {
      outcomeCounts[run.outcome] += 1;
      return run.outcome;
    });
    const passes = outcomeCounts.pass;
    const observedPassRate = passes / group.repeatCount;
    const repeatVariance =
      group.runs.reduce((sum, run) => {
        const value = run.outcome === "pass" ? 1 : 0;
        return sum + (value - observedPassRate) ** 2;
      }, 0) / group.repeatCount;
    const warnings: FixtureDiagnosticWarning[] = [];
    const diagnosticClass: FixtureDiagnosticClass =
      group.repeatCount < MIN_REPEAT_COUNT_FOR_GATING
        ? "insufficient-sample"
        : passes === group.repeatCount
          ? "stable-pass"
          : passes === 0
            ? "stable-fail"
            : "repeat-unstable";

    if (diagnosticClass === "insufficient-sample") {
      warnings.push("insufficient-sample");
    }
    if (diagnosticClass === "repeat-unstable") {
      warnings.push("low-signal-repeat-instability");
    }
    if (group.runs.some((run) => !run.executionProfile.gateEligible)) {
      warnings.push("non-gating-execution-profile");
    }

    diagnostics.push({
      fixtureId: group.fixtureId,
      repeatCount: group.repeatCount,
      outcomes,
      outcomeCounts,
      observedPassRate,
      repeatVariance,
      diagnosticClass,
      warnings,
    });
  }
  return diagnostics;
}

export function aggregateFixtureDiagnostics(
  diagnostics: readonly FixtureDiagnostics[],
): FixtureDiagnosticAggregate {
  const aggregate: FixtureDiagnosticAggregate = {
    fixtureCount: diagnostics.length,
    stablePass: 0,
    stableFail: 0,
    repeatUnstable: 0,
    insufficientSample: 0,
    nonGating: 0,
    lowSignalWarnings: 0,
  };
  for (const diagnostic of diagnostics) {
    if (diagnostic.diagnosticClass === "stable-pass") {
      aggregate.stablePass += 1;
    } else if (diagnostic.diagnosticClass === "stable-fail") {
      aggregate.stableFail += 1;
    } else if (diagnostic.diagnosticClass === "repeat-unstable") {
      aggregate.repeatUnstable += 1;
    } else {
      aggregate.insufficientSample += 1;
    }
    if (diagnostic.warnings.includes("non-gating-execution-profile")) {
      aggregate.nonGating += 1;
    }
    if (diagnostic.warnings.includes("low-signal-repeat-instability")) {
      aggregate.lowSignalWarnings += 1;
    }
  }
  return aggregate;
}

export function computeFixtureDiagnostics(
  runs: readonly FixtureRun[],
): FixtureDiagnosticsReport {
  const perFixture = diagnosticsPerFixture(runs);
  return {
    perFixture,
    aggregate: aggregateFixtureDiagnostics(perFixture),
  };
}

/**
 * Aggregate per-fixture scores into a single pass@k / pass^k pair. Reports a
 * `null` `repeatCount` when fixtures in the set used different k values —
 * diffing aggregate scores across mismatched k is misleading and the caller
 * should partition before comparing.
 */
export function aggregateScores(scores: readonly FixtureScore[]): AggregateScore {
  if (scores.length === 0) {
    return { fixtureCount: 0, repeatCount: null, passAtK: 0, passHatK: 0 };
  }
  const first = scores[0].repeatCount;
  const uniformK = scores.every((s) => s.repeatCount === first);
  const passAt = scores.filter((s) => s.passedAny).length / scores.length;
  const passHat = scores.filter((s) => s.passedAll).length / scores.length;
  return {
    fixtureCount: scores.length,
    repeatCount: uniformK ? first : null,
    passAtK: passAt,
    passHatK: passHat,
  };
}

export function scoreFixtureSet(runs: readonly FixtureRun[]): AggregateScore {
  return aggregateScores(scorePerFixture(runs));
}
