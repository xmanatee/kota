/**
 * Eval-harness module — owns the autonomy eval contract AND the fixture
 * runner that applies it.
 *
 * Scope:
 *   - Typed fixture-run contract, `pass@k` / `pass^k` scoring, and the
 *     regression-gate decision (noise-band rule).
 *   - Fixture format, isolated-worktree runner, CLI entry, HTTP route, and
 *     the weekly cadence workflow.
 *
 * Aggregate scores flow back through the shared event bus
 * (`eval-harness.set.completed`). Per-run evidence lives as run artifacts.
 * There is no parallel metrics store.
 */

import type { KotaModule } from "#core/modules/module-types.js";
import evalHarnessCadence from "./cadence-workflow.js";
import { buildEvalCommand } from "./cli.js";
import evalHarnessRegressionNotify from "./regression-notify-workflow.js";
import { evalHarnessRoutes } from "./routes.js";

export type {
  BaselineAssessment,
  CandidateAssessment,
} from "./baseline-assessment.js";
export { assessAgainstBaseline } from "./baseline-assessment.js";
export type { PersistedBaseline } from "./baseline-store.js";
export {
  baselineFilePath,
  loadBaseline,
  saveBaseline,
} from "./baseline-store.js";
export type { EvalSetParams, EvalSetReport } from "./eval-set.js";
export { runEvalSet } from "./eval-set.js";
export type {
  FixtureAutonomyRole,
  FixtureSpecFile,
  LoadedFixture,
} from "./fixture.js";
export { loadAllFixtures, loadFixture } from "./fixture.js";
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
export type { FixturePredicate, PredicateEvalResult } from "./predicates.js";
export { evaluatePredicate, evaluatePredicates } from "./predicates.js";
export type {
  FixtureRunReport,
  RunFixtureParams,
  WorkflowExecutionOutcome,
  WorkflowExecutionRequest,
  WorkflowExecutor,
} from "./runner.js";
export { cleanupFixtureWorkingDir, runFixture } from "./runner.js";
export type { AggregateScore, FixtureScore } from "./scoring.js";
export { aggregateScores, scoreFixtureSet, scorePerFixture } from "./scoring.js";
export type { SubprocessExecutorOptions } from "./subprocess-executor.js";
export { createSubprocessExecutor } from "./subprocess-executor.js";

const evalHarnessModule: KotaModule = {
  name: "eval-harness",
  version: "0.2.0",
  description:
    "Autonomy eval harness: fixture-run contract, scoring, regression gate, fixture runner, CLI + HTTP route, and weekly cadence workflow.",
  commands: (ctx) => [buildEvalCommand(ctx.cwd)],
  routes: (ctx) => evalHarnessRoutes(ctx),
  workflows: [evalHarnessCadence, evalHarnessRegressionNotify],
};

export default evalHarnessModule;
