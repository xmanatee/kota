
import { join } from "node:path";
import { finalizeCodeHealthDiagnostics } from "./code-health-diagnostics.js";
import { type FixtureRun, resourceProfileFromExecutionProfile } from "./fixture-run.js";
import { evaluateObjectiveMetrics } from "./objective-metrics.js";
import { evaluatePredicateExpectations, evaluatePredicates } from "./predicates.js";
import { writeRunArtifact } from "./runner-artifact.js";
import { codeHealthBaselineFor, finalCodeHealthFor } from "./runner-code-health.js";
import { fixtureExecutionMode, materializeFixtureWorkingDir } from "./runner-materialize.js";
import { outcomeFromExecution } from "./runner-outcome.js";
import type { FixtureRunReport, RunFixtureParams, WorkflowExecutionOutcome } from "./runner-types.js";
import { evaluateVerifierCalibration, verifierCalibrationConfigurationError, writeVerifierCalibrationArtifact } from "./runner-verifier.js";

export async function runSingleWorkflowFixture(
  params: RunFixtureParams,
): Promise<FixtureRunReport> {
  const spec = params.fixture.spec;
  if (spec.mode !== "single-workflow") {
    throw new Error(
      `runSingleWorkflowFixture received non-single fixture "${spec.id}".`,
    );
  }
  const { workingDir, shimDir } = materializeFixtureWorkingDir(params.fixture);
  const codeHealthBaseline = codeHealthBaselineFor(workingDir, spec);
  const startedAt = new Date();
  const startMs = startedAt.getTime();
  let executionOutcome: WorkflowExecutionOutcome;
  const preRunSanity = evaluatePredicateExpectations(
    workingDir,
    spec.preRunExpectations,
  );
  const resourceProfile = resourceProfileFromExecutionProfile(
    params.executionProfile,
  );
  const runArtifactDir = join(
    params.runArtifactBaseDir,
    `${params.fixture.spec.id}-${params.runIndex}`,
  );
  const verifierCalibration = evaluateVerifierCalibration({
    fixture: params.fixture,
    executionProfile: params.executionProfile,
    runIndex: params.runIndex,
    repeatCount: params.repeatCount,
  });
  if (verifierCalibration !== undefined) {
    writeVerifierCalibrationArtifact(runArtifactDir, verifierCalibration);
  }
  if (verifierCalibration !== undefined && !verifierCalibration.passed) {
    executionOutcome = {
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
      fixtureId: params.fixture.spec.id,
      runIndex: params.runIndex,
      repeatCount: params.repeatCount,
      executionMode: fixtureExecutionMode(params.fixture),
      outcome: outcomeFromExecution(executionOutcome, false),
      resourceProfile,
      executionProfile: params.executionProfile,
      objectiveMetrics: [],
      configurationError,
      ...(codeHealthDiagnostics !== undefined && { codeHealthDiagnostics }),
      timing: {
        startedAt: startedAt.toISOString(),
        durationMs: executionOutcome.durationMs,
        budgetMs: spec.budgetMs,
      },
      runArtifactPath: runArtifactDir,
    };
    writeRunArtifact(runArtifactDir, {
      run,
      fixtureId: spec.id,
      workflowName: spec.workflowName,
      workingDir,
      executionOutcome,
      executionProfile: params.executionProfile,
      predicates: spec.predicates,
      preRunExpectationResults: [],
      predicateResults: [],
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
  if (!preRunSanity.passed) {
    executionOutcome = {
      kind: "not-started",
      durationMs: Date.now() - startMs,
      reason: "pre-run-sanity-failed",
      runArtifactPath: null,
    };
    const codeHealthDiagnostics =
      spec.codeHealthDiagnostics !== undefined && codeHealthBaseline !== undefined
        ? finalizeCodeHealthDiagnostics({
            config: spec.codeHealthDiagnostics,
            baseline: codeHealthBaseline,
            rounds: [],
          })
        : undefined;
    const run: FixtureRun = {
      fixtureId: params.fixture.spec.id,
      runIndex: params.runIndex,
      repeatCount: params.repeatCount,
      executionMode: fixtureExecutionMode(params.fixture),
      outcome: outcomeFromExecution(executionOutcome, false),
      resourceProfile,
      executionProfile: params.executionProfile,
      objectiveMetrics: [],
      ...(codeHealthDiagnostics !== undefined && { codeHealthDiagnostics }),
      timing: {
        startedAt: startedAt.toISOString(),
        durationMs: executionOutcome.durationMs,
        budgetMs: spec.budgetMs,
      },
      runArtifactPath: runArtifactDir,
    };
    writeRunArtifact(runArtifactDir, {
      run,
      fixtureId: spec.id,
      workflowName: spec.workflowName,
      workingDir,
      executionOutcome,
      executionProfile: params.executionProfile,
      predicates: spec.predicates,
      preRunExpectationResults: preRunSanity.results,
      predicateResults: [],
      objectiveMetrics: [],
      ...(verifierCalibration !== undefined && { verifierCalibration }),
    });
    return {
      run,
      predicateResults: [],
      preRunExpectationResults: preRunSanity.results,
      objectiveMetrics: [],
      workingDir,
      executionOutcome,
    };
  }
  try {
    executionOutcome = await params.executor.execute({
      workflowName: spec.workflowName,
      workingDir,
      budgetMs: spec.budgetMs,
      executionProfile: params.executionProfile,
      ...(params.agentExecutionOverride !== undefined && {
        agentExecutionOverride: params.agentExecutionOverride,
      }),
      ...(spec.triggerPayload !== undefined && {
        triggerPayload: spec.triggerPayload,
      }),
      ...(params.fixture.agentStepRecordings.length > 0 && {
        replayRecordingsRoot: params.fixture.fixtureDir,
      }),
      ...(shimDir !== null && { externalCallShimDir: shimDir }),
    });
  } catch (err) {
    executionOutcome = {
      kind: "error",
      durationMs: Date.now() - startMs,
      message: err instanceof Error ? err.message : String(err),
      runArtifactPath: null,
    };
  }

  const { passed, results } = evaluatePredicates(
    workingDir,
    spec.predicates,
  );
  const outcome = outcomeFromExecution(executionOutcome, passed);
  const codeHealthDiagnostics = finalCodeHealthFor({
    workingDir,
    spec,
    baseline: codeHealthBaseline,
    outcome,
  });
  const objectiveMetrics = evaluateObjectiveMetrics({
    fixtureId: spec.id,
    metricSpecs: spec.objectiveMetrics ?? [],
    workingDir,
    executionProfile: params.executionProfile,
    runIndex: params.runIndex,
    repeatCount: params.repeatCount,
  });

  const run: FixtureRun = {
    fixtureId: params.fixture.spec.id,
    runIndex: params.runIndex,
    repeatCount: params.repeatCount,
    executionMode: fixtureExecutionMode(params.fixture),
    outcome,
    resourceProfile,
    executionProfile: params.executionProfile,
    objectiveMetrics,
    ...(codeHealthDiagnostics !== undefined && { codeHealthDiagnostics }),
    timing: {
      startedAt: startedAt.toISOString(),
      durationMs: executionOutcome.durationMs,
      budgetMs: spec.budgetMs,
    },
    runArtifactPath: runArtifactDir,
  };

  writeRunArtifact(runArtifactDir, {
    run,
    fixtureId: spec.id,
    workflowName: spec.workflowName,
    workingDir,
    executionOutcome,
    executionProfile: params.executionProfile,
    predicates: spec.predicates,
    preRunExpectationResults: preRunSanity.results,
    predicateResults: results,
    objectiveMetrics,
    ...(verifierCalibration !== undefined && { verifierCalibration }),
  });

  return {
    run,
    predicateResults: results,
    preRunExpectationResults: preRunSanity.results,
    objectiveMetrics,
    workingDir,
    executionOutcome,
  };
}
