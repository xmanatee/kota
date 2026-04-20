/**
 * Eval-harness module — owns the autonomy eval contract.
 *
 * Current scope: typed fixture-run contract, pass@k / pass^k scoring, and
 * the regression-gate decision that treats infrastructure noise as a
 * first-class confounder. Fixture runner, CLI entry, and HTTP routes land
 * in follow-up work on `task-build-an-outcome-eval-harness-for-autonomy-workflo`.
 */

import type { KotaModule } from "#core/modules/module-types.js";

export type {
  FixtureRun,
  FixtureRunOutcome,
  ResourceProfile,
  TimingEnvelope,
} from "./fixture-run.js";
export { resourceProfilesComparable } from "./fixture-run.js";
export type { RegressionGateDecision, RegressionGateInput } from "./noise-band.js";
export {
  DEFAULT_NOISE_BAND_PP,
  evaluateRegressionGate,
  MIN_REPEAT_COUNT_FOR_GATING,
} from "./noise-band.js";
export type { AggregateScore, FixtureScore } from "./scoring.js";
export { aggregateScores, scoreFixtureSet, scorePerFixture } from "./scoring.js";

const evalHarnessModule: KotaModule = {
  name: "eval-harness",
  version: "0.1.0",
  description: "Autonomy eval-harness contract (fixture-run shape, scoring, regression gate)",
};

export default evalHarnessModule;
