/**
 * Eval-set runner — executes a set of fixtures at a given repeat count,
 * writes the aggregate score artifact, and returns the structured report
 * callers (CLI / HTTP route / cadence workflow) surface back.
 *
 * The aggregate artifact is the single observable the telemetry layer keys
 * off. We do NOT maintain a parallel metrics store (see module AGENTS.md).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PersistedBaseline } from "./baseline-state.js";
import {
  aggregateCodeHealthDiagnostics,
  type CodeHealthAggregate,
} from "./code-health-diagnostics.js";
import {
  buildEvalComponentAttribution,
  collectFixtureRunAttributionEvidence,
  type EvalComponentAttribution,
  type EvalFixtureRunAttributionEvidence,
} from "./eval-attribution.js";
import {
  type FixtureControlDecisionCoverageSummary,
  type LoadedFixture,
  summarizeControlDecisionCoverage,
} from "./fixture.js";
import type {
  ExecutionProfilePreflightResult,
  FixtureRun,
  ResourceProfile,
} from "./fixture-run.js";
import {
  assertExecutionProfileCanScore,
  resourceProfileFromExecutionProfile,
} from "./fixture-run.js";
import {
  type AggregateObjectiveMetric,
  aggregateObjectiveMetrics,
} from "./objective-metrics.js";
import {
  addFixtureRunHarnessModelEvidence,
  buildEvalRunConfiguration,
  createResolvedHarnessModelEvidenceAccumulator,
  type EvalRunConfiguration,
  finalizeResolvedHarnessModelEvidence,
} from "./run-configuration.js";
import {
  cleanupFixtureWorkingDir,
  type FixtureRunReport,
  runFixture,
  type WorkflowAgentExecutionOverride,
  type WorkflowExecutor,
} from "./runner.js";
import type {
  AggregateScore,
  FixtureDiagnosticsReport,
  FixtureScore,
} from "./scoring.js";
import {
  aggregateScores,
  computeFixtureDiagnostics,
  scorePerFixture,
} from "./scoring.js";

export type EvalSetParams = {
  workspaceRoot: string;
  fixtures: readonly LoadedFixture[];
  executor: WorkflowExecutor;
  requestedProfile: ResourceProfile;
  agentExecutionOverride?: WorkflowAgentExecutionOverride;
  runArtifactBaseDir: string;
  repeatCount: number;
  priorBaseline?: PersistedBaseline | null;
  /** Preset-selection environment used to fingerprint this eval run. */
  env?: NodeJS.ProcessEnv;
  /**
   * Whether to retain fixture working directories after the run. False by
   * default; set true from CLI `--keep` for post-mortem debugging.
   */
  keepWorkingDirs?: boolean;
};

export type EvalSetReport = {
  runs: readonly FixtureRun[];
  /** Internal per-attempt evidence retained for specialized suite projections. */
  runReports: readonly FixtureRunReport[];
  perFixture: readonly FixtureScore[];
  fixtureDiagnostics: FixtureDiagnosticsReport;
  aggregate: AggregateScore;
  controlDecisionCoverage: FixtureControlDecisionCoverageSummary;
  objectiveMetrics: readonly AggregateObjectiveMetric[];
  codeHealth: CodeHealthAggregate;
  runConfiguration: EvalRunConfiguration;
  componentAttribution: EvalComponentAttribution;
  resourceProfile: ResourceProfile;
  executionProfile: ExecutionProfilePreflightResult;
  repeatCount: number;
  runArtifactBaseDir: string;
  /** ISO timestamps bracketing the full set. */
  startedAt: string;
  completedAt: string;
};

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer, got ${value}.`);
  }
}

/**
 * Run every fixture `repeatCount` times against the given executor. Fixtures
 * run sequentially — parallel replicas are deliberately off by default to
 * keep the resource profile per run honest (the noise-band rule assumes a
 * single fixture has the host to itself).
 */
export async function runEvalSet(params: EvalSetParams): Promise<EvalSetReport> {
  assertPositiveInteger(params.repeatCount, "repeatCount");
  if (params.fixtures.length === 0) {
    throw new Error("runEvalSet called with an empty fixture set.");
  }
  const executionProfile = params.executor.preflight(params.requestedProfile);
  mkdirSync(params.runArtifactBaseDir, { recursive: true });
  writeFileSync(
    join(params.runArtifactBaseDir, "eval-resource-profile-preflight.json"),
    JSON.stringify(executionProfile, null, 2),
  );
  assertExecutionProfileCanScore(executionProfile);
  const resourceProfile = resourceProfileFromExecutionProfile(
    executionProfile,
  );
  const startedAt = new Date().toISOString();

  const runs: FixtureRun[] = [];
  const runReports: FixtureRunReport[] = [];
  const runArtifactEvidence: EvalFixtureRunAttributionEvidence[] = [];
  const resolvedHarnessModelEvidence =
    createResolvedHarnessModelEvidenceAccumulator();
  for (const fixture of params.fixtures) {
    for (let runIndex = 0; runIndex < params.repeatCount; runIndex++) {
      const report = await runFixture({
        fixture,
        executor: params.executor,
        executionProfile,
        ...(params.agentExecutionOverride !== undefined && {
          agentExecutionOverride: params.agentExecutionOverride,
        }),
        runArtifactBaseDir: params.runArtifactBaseDir,
        runIndex,
        repeatCount: params.repeatCount,
      });
      runs.push(report.run);
      runReports.push(report);
      addFixtureRunHarnessModelEvidence(
        resolvedHarnessModelEvidence,
        fixture,
        report,
      );
      runArtifactEvidence.push(collectFixtureRunAttributionEvidence(report.run));
      if (!params.keepWorkingDirs) {
        cleanupFixtureWorkingDir(report.workingDir);
      }
    }
  }

  const perFixture = scorePerFixture(runs);
  const aggregate = aggregateScores(perFixture);
  const fixtureDiagnostics = computeFixtureDiagnostics(runs);
  const controlDecisionCoverage = summarizeControlDecisionCoverage(params.fixtures);
  const objectiveMetrics = aggregateObjectiveMetrics(runs);
  const codeHealth = aggregateCodeHealthDiagnostics(runs);
  const completedAt = new Date().toISOString();
  const runConfiguration = buildEvalRunConfiguration({
    workspaceRoot: params.workspaceRoot,
    fixtures: params.fixtures,
    resourceProfile,
    executionProfile,
    resolvedHarnessModelEvidence: finalizeResolvedHarnessModelEvidence(
      resolvedHarnessModelEvidence,
    ),
    ...(params.env !== undefined && { env: params.env }),
  });
  const componentAttribution = buildEvalComponentAttribution({
    priorBaseline: params.priorBaseline ?? null,
    runs,
    perFixture,
    fixtureDiagnostics,
    objectiveMetrics,
    codeHealth,
    runConfiguration,
    resourceProfile,
    executionProfile,
    repeatCount: params.repeatCount,
    runArtifactBaseDir: params.runArtifactBaseDir,
    runArtifactEvidence,
  });

  writeFileSync(
    join(params.runArtifactBaseDir, "eval-set-report.json"),
    JSON.stringify(
      {
        startedAt,
        completedAt,
        repeatCount: params.repeatCount,
        resourceProfile,
        executionProfile,
        runs,
        perFixture,
        fixtureDiagnostics,
        aggregate,
        controlDecisionCoverage,
        objectiveMetrics,
        codeHealth,
        runConfiguration,
        componentAttribution,
      },
      null,
      2,
    ),
  );

  return {
    runs,
    runReports,
    perFixture,
    fixtureDiagnostics,
    aggregate,
    controlDecisionCoverage,
    objectiveMetrics,
    codeHealth,
    runConfiguration,
    componentAttribution,
    resourceProfile,
    executionProfile,
    repeatCount: params.repeatCount,
    runArtifactBaseDir: params.runArtifactBaseDir,
    startedAt,
    completedAt,
  };
}
