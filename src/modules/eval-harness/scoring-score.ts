
import type { FixtureRun } from "./fixture-run.js";
import { groupCompleteFixtureRuns } from "./scoring-groups.js";
import type { AggregateScore, FixtureScore } from "./scoring-types.js";

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
