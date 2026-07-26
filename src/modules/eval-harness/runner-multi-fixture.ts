
import { join } from "node:path";
import { type CodeHealthRoundDiagnostics, evaluateCodeHealthRound, finalizeCodeHealthDiagnostics } from "./code-health-diagnostics.js";
import { type FixtureRun, type FixtureRunOutcome, resourceProfileFromExecutionProfile } from "./fixture-run.js";
import { evaluateObjectiveMetrics, type ObservedObjectiveMetric } from "./objective-metrics.js";
import type { PredicateEvalResult } from "./predicates.js";
import { evaluatePredicates } from "./predicates.js";
import { codeHealthBaselineFor } from "./runner-code-health.js";
import { fixtureExecutionMode, materializeFixtureWorkingDir } from "./runner-materialize.js";
import { roundRunSummary, writeMultiRoundRunArtifact } from "./runner-multi-artifact.js";
import { outcomeFromExecution } from "./runner-outcome.js";
import { executeRound } from "./runner-rounds.js";
import type { FixtureRunReport, RoundRunReport, RunFixtureParams, WorkflowExecutionOutcome } from "./runner-types.js";
import { evaluateVerifierCalibration, verifierCalibrationConfigurationError, writeVerifierCalibrationArtifact } from "./runner-verifier.js";

export async function runMultiRoundFixture(
  params: RunFixtureParams,
): Promise<FixtureRunReport> {
  const spec = params.fixture.spec;
  if (spec.mode !== "multi-round") {
    throw new Error(
      `runMultiRoundFixture received non-multi-round fixture "${spec.id}".`,
    );
  }
  const { workingDir, shimDir } = materializeFixtureWorkingDir(params.fixture);
  const codeHealthBaseline = codeHealthBaselineFor(workingDir, spec);
  const codeHealthRounds: CodeHealthRoundDiagnostics[] = [];
  const startedAt = new Date();
  const startMs = startedAt.getTime();
  const resourceProfile = resourceProfileFromExecutionProfile(
    params.executionProfile,
  );
  const runArtifactDir = join(
    params.runArtifactBaseDir,
    `${spec.id}-${params.runIndex}`,
  );
  const verifierCalibration = await evaluateVerifierCalibration({
    fixture: params.fixture,
    executionProfile: params.executionProfile,
    predicateContext: params.executor.predicateContext,
    runIndex: params.runIndex,
    repeatCount: params.repeatCount,
  });
  if (verifierCalibration !== undefined) {
    writeVerifierCalibrationArtifact(runArtifactDir, verifierCalibration);
  }
  if (verifierCalibration !== undefined && !verifierCalibration.passed) {
    const executionOutcome: WorkflowExecutionOutcome = {
      kind: "not-started",
      durationMs: Date.now() - startMs,
      reason: "verifier-calibration-failed",
      runArtifactPath: null,
    };
    const configurationError =
      verifierCalibrationConfigurationError(verifierCalibration);
    const codeHealthDiagnostics =
      spec.codeHealthDiagnostics !== undefined && codeHealthBaseline !== undefined
        ? finalizeCodeHealthDiagnostics({
            config: spec.codeHealthDiagnostics,
            baseline: codeHealthBaseline,
            rounds: [],
          })
        : undefined;
    const run: FixtureRun = {
      fixtureId: spec.id,
      runIndex: params.runIndex,
      repeatCount: params.repeatCount,
      executionMode: fixtureExecutionMode(params.fixture),
      outcome: outcomeFromExecution(executionOutcome, false),
      resourceProfile,
      executionProfile: params.executionProfile,
      objectiveMetrics: [],
      configurationError,
      ...(codeHealthDiagnostics !== undefined && { codeHealthDiagnostics }),
      rounds: [],
      timing: {
        startedAt: startedAt.toISOString(),
        durationMs: executionOutcome.durationMs,
        budgetMs: spec.rounds.reduce((sum, round) => sum + round.budgetMs, 0),
      },
      runArtifactPath: runArtifactDir,
    };
    writeMultiRoundRunArtifact(runArtifactDir, {
      run,
      fixtureId: spec.id,
      workingDir,
      executionProfile: params.executionProfile,
      spec,
      roundResults: [],
      aggregatePredicateResults: [],
      objectiveMetrics: [],
      verifierCalibration,
    });
    return {
      run,
      predicateResults: [],
      preRunExpectationResults: [],
      objectiveMetrics: [],
      workingDir,
      executionOutcome,
    };
  }

  const roundResults: RoundRunReport[] = [];
  for (let roundIndex = 0; roundIndex < spec.rounds.length; roundIndex++) {
    const round = spec.rounds[roundIndex];
    const roundResult = await executeRound({
      round,
      roundIndex,
      fixture: params.fixture,
      executor: params.executor,
      executionProfile: params.executionProfile,
      ...(params.agentExecutionOverride !== undefined && {
        agentExecutionOverride: params.agentExecutionOverride,
      }),
      workingDir,
      shimDir,
      runIndex: params.runIndex,
      repeatCount: params.repeatCount,
    });
    roundResults.push(roundResult);
    if (
      spec.codeHealthDiagnostics !== undefined &&
      codeHealthBaseline !== undefined
    ) {
      const previous =
        codeHealthRounds[codeHealthRounds.length - 1]?.measurement ??
        codeHealthBaseline;
      codeHealthRounds.push(
        evaluateCodeHealthRound({
          config: spec.codeHealthDiagnostics,
          workingDir,
          baseline: codeHealthBaseline,
          previous,
          roundId: round.id,
          roundIndex,
          outcome: roundResult.outcome,
        }),
      );
    }
    if (roundResult.outcome !== "pass") break;
  }

  let aggregatePredicateResults: PredicateEvalResult[] = [];
  let aggregatePredicatesPassed = true;
  let objectiveMetrics: ObservedObjectiveMetric[] = [];
  const failedRound = roundResults.find((result) => result.outcome !== "pass");
  if (failedRound === undefined) {
    const aggregate = await evaluatePredicates(
      workingDir,
      spec.aggregatePredicates ?? [],
      params.executor.predicateContext,
    );
    aggregatePredicateResults = aggregate.results;
    aggregatePredicatesPassed = aggregate.passed;
    objectiveMetrics = evaluateObjectiveMetrics({
      fixtureId: spec.id,
      metricSpecs: spec.aggregateObjectiveMetrics ?? [],
      workingDir,
      executionProfile: params.executionProfile,
      runIndex: params.runIndex,
      repeatCount: params.repeatCount,
    });
  }

  const outcome: FixtureRunOutcome =
    failedRound !== undefined
      ? failedRound.outcome
      : aggregatePredicatesPassed
        ? "pass"
        : "fail";
  const executionOutcome: WorkflowExecutionOutcome =
    failedRound?.executionOutcome ??
    ({
      kind: "completed",
      durationMs: Date.now() - startMs,
      runArtifactPath:
        roundResults[roundResults.length - 1]?.executionOutcome.runArtifactPath ?? null,
    } satisfies WorkflowExecutionOutcome);
  const codeHealthDiagnostics =
    spec.codeHealthDiagnostics !== undefined && codeHealthBaseline !== undefined
      ? finalizeCodeHealthDiagnostics({
          config: spec.codeHealthDiagnostics,
          baseline: codeHealthBaseline,
          rounds: codeHealthRounds,
        })
      : undefined;
  const run: FixtureRun = {
    fixtureId: spec.id,
    runIndex: params.runIndex,
    repeatCount: params.repeatCount,
    executionMode: fixtureExecutionMode(params.fixture),
    outcome,
    resourceProfile,
    executionProfile: params.executionProfile,
    objectiveMetrics,
    ...(codeHealthDiagnostics !== undefined && { codeHealthDiagnostics }),
    rounds: roundResults.map(roundRunSummary),
    timing: {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startMs,
      budgetMs: spec.rounds.reduce((sum, round) => sum + round.budgetMs, 0),
    },
    runArtifactPath: runArtifactDir,
  };

  writeMultiRoundRunArtifact(runArtifactDir, {
    run,
    fixtureId: spec.id,
    workingDir,
    executionProfile: params.executionProfile,
    spec,
    roundResults,
    aggregatePredicateResults,
    objectiveMetrics,
    ...(verifierCalibration !== undefined && { verifierCalibration }),
  });

  return {
    run,
    predicateResults:
      failedRound !== undefined
        ? failedRound.predicateResults
        : aggregatePredicateResults,
    preRunExpectationResults:
      failedRound?.preRunExpectationResults ??
      roundResults.flatMap((result) => result.preRunExpectationResults),
    objectiveMetrics,
    workingDir,
    executionOutcome,
  };
}
