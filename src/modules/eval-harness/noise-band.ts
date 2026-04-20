/**
 * Regression-gate decision for the autonomy eval harness.
 *
 * A candidate change only gates an autonomy rollout when its consistency
 * score (`pass^k`) drops beyond the noise band AND the resource profile
 * between baseline and candidate is stable. This encodes the Mar 2026
 * infrastructure-noise rule into a single decision function so harness
 * callers cannot forget either half.
 */

import type { ResourceProfile } from "./fixture-run.js";
import { resourceProfilesComparable } from "./fixture-run.js";
import type { AggregateScore } from "./scoring.js";

/**
 * Default noise band in percentage points. Anthropic's "Quantifying
 * infrastructure noise in agentic coding evals" (Mar 2026) documents that
 * container resource configuration alone can swing Terminal-Bench 2.0
 * scores by ~6pp, larger than the gap used to rank competing models. 3pp
 * is our default skepticism threshold; operators can calibrate higher
 * values per host class when they have evidence.
 */
export const DEFAULT_NOISE_BAND_PP = 3;

/**
 * Minimum repeat count required before a gate decision can fire. k=1 collapses
 * `pass^k` to a single-run outcome — a single flaky run is not evidence of a
 * regression, so the gate refuses to participate until the harness collects
 * at least this many runs per fixture.
 */
export const MIN_REPEAT_COUNT_FOR_GATING = 3;

export type RegressionGateInput = {
  baseline: AggregateScore;
  candidate: AggregateScore;
  baselineResourceProfile: ResourceProfile;
  candidateResourceProfile: ResourceProfile;
  /** Noise band expressed in percentage points of `pass^k`. */
  noiseBandPercentagePoints: number;
};

export type RegressionGateDecision =
  | {
      status: "gated";
      dropPercentagePoints: number;
      reason: string;
    }
  | {
      status: "not-gated";
      dropPercentagePoints: number;
      reason:
        | "within-noise-band"
        | "resource-profile-drift"
        | "pass-hat-k-improved"
        | "repeat-count-mismatch"
        | "repeat-count-below-minimum"
        | "empty-fixture-set";
    };

/**
 * Decide whether a candidate's eval run should block an autonomy change.
 *
 * A regression gate fires only when ALL of the following hold:
 *   1. `pass^k` dropped from baseline to candidate by more than the noise band.
 *   2. Both runs used the same repeat count `k` (mismatched k is not comparable).
 *   3. Both runs used comparable resource profiles (host class + allocation +
 *      kill thresholds). Drift in any of those invalidates the comparison.
 */
export function evaluateRegressionGate(
  input: RegressionGateInput,
): RegressionGateDecision {
  const { baseline, candidate, noiseBandPercentagePoints } = input;
  const dropPct =
    Math.round((baseline.passHatK - candidate.passHatK) * 10000) / 100;

  if (baseline.fixtureCount === 0 || candidate.fixtureCount === 0) {
    return {
      status: "not-gated",
      dropPercentagePoints: dropPct,
      reason: "empty-fixture-set",
    };
  }

  if (
    baseline.repeatCount === null ||
    candidate.repeatCount === null ||
    baseline.repeatCount !== candidate.repeatCount
  ) {
    return {
      status: "not-gated",
      dropPercentagePoints: dropPct,
      reason: "repeat-count-mismatch",
    };
  }

  if (baseline.repeatCount < MIN_REPEAT_COUNT_FOR_GATING) {
    return {
      status: "not-gated",
      dropPercentagePoints: dropPct,
      reason: "repeat-count-below-minimum",
    };
  }

  if (candidate.passHatK >= baseline.passHatK) {
    return {
      status: "not-gated",
      dropPercentagePoints: dropPct,
      reason: "pass-hat-k-improved",
    };
  }

  if (dropPct <= noiseBandPercentagePoints) {
    return {
      status: "not-gated",
      dropPercentagePoints: dropPct,
      reason: "within-noise-band",
    };
  }

  if (
    !resourceProfilesComparable(
      input.baselineResourceProfile,
      input.candidateResourceProfile,
    )
  ) {
    return {
      status: "not-gated",
      dropPercentagePoints: dropPct,
      reason: "resource-profile-drift",
    };
  }

  return {
    status: "gated",
    dropPercentagePoints: dropPct,
    reason: `pass^k dropped ${dropPct}pp (baseline ${(baseline.passHatK * 100).toFixed(1)}% → candidate ${(candidate.passHatK * 100).toFixed(1)}%) beyond ${noiseBandPercentagePoints}pp noise band at stable resource profile "${input.baselineResourceProfile.hostClass}".`,
  };
}
