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

import type { FixtureRun } from "./fixture-run.js";

export type FixtureScore = {
  fixtureId: string;
  repeatCount: number;
  passedAny: boolean;
  passedAll: boolean;
  observedPassRate: number;
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

/**
 * Group runs by fixtureId and compute per-fixture scores. Runs are expected
 * to be complete repeat sets for each fixture — a partial set fails loudly
 * rather than scoring a half-run as a flaky pass.
 */
export function scorePerFixture(runs: readonly FixtureRun[]): FixtureScore[] {
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

  const scores: FixtureScore[] = [];
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

    const passes = bucket.filter((r) => r.outcome === "pass").length;
    scores.push({
      fixtureId,
      repeatCount,
      passedAny: passes > 0,
      passedAll: passes === repeatCount,
      observedPassRate: passes / repeatCount,
    });
  }

  return scores;
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
