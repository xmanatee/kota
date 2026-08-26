import { join } from "node:path";
import type { PersistedBaseline } from "./baseline-state.js";
import type { CodeHealthAggregate } from "./code-health-diagnostics.js";
import {
  artifactEvidenceMap,
  collectFixtureRunAttributionEvidence,
} from "./eval-attribution-artifact-evidence.js";
import {
  buildComponents,
  changedComponents,
} from "./eval-attribution-components.js";
import { diagnosticSummaryFromPerFixture } from "./eval-attribution-diagnostics.js";
import { buildPerFixtureAttribution } from "./eval-attribution-per-fixture.js";
import { readPriorReport } from "./eval-attribution-prior.js";
import type {
  EvalAttributionBaselineStatus,
  EvalAttributionComponentId,
  EvalComponentAttribution,
  EvalComponentAttributionAssessmentSummary,
  EvalComponentAttributionOperatorSummary,
  EvalFixtureAttributionSummary,
  EvalFixtureRunAttributionEvidence,
} from "./eval-attribution-types.js";
import type {
  ExecutionProfilePreflightResult,
  FixtureRun,
  ResourceProfile,
} from "./fixture-run.js";
import type { AggregateObjectiveMetric } from "./objective-metrics.js";
import {
  compareRunConfigurations,
  type EvalRunConfiguration,
  type EvalRunConfigurationComparison,
  missingPriorRunConfigurationComparison,
} from "./run-configuration.js";
import type {
  FixtureDiagnosticsReport,
  FixtureScore,
} from "./scoring.js";

export type {
  EvalAttributionBaselineStatus,
  EvalAttributionCodeCount,
  EvalAttributionComponentEntry,
  EvalAttributionComponentId,
  EvalAttributionComponentStatus,
  EvalAttributionDiagnosticSummary,
  EvalComponentAttribution,
  EvalComponentAttributionAssessmentSummary,
  EvalComponentAttributionOperatorSummary,
  EvalFixtureArtifactEvidenceSummary,
  EvalFixtureAttributionSummary,
  EvalFixtureObjectiveMetricDelta,
  EvalFixtureOutcomeAttribution,
  EvalFixtureRunAttributionEvidence,
} from "./eval-attribution-types.js";
export { collectFixtureRunAttributionEvidence };

function attributionSummary(params: {
  baselineStatus: EvalAttributionBaselineStatus;
  changedComponents: readonly EvalAttributionComponentId[];
  perFixture: readonly EvalFixtureAttributionSummary[];
}): string {
  if (params.baselineStatus === "no-baseline") {
    return "component attribution recorded for current eval set; no prior baseline comparison";
  }
  const outcomeDeltas = params.perFixture.filter(
    (fixture) =>
      fixture.outcomeDelta !== "unchanged" &&
      fixture.outcomeDelta !== "no-baseline",
  ).length;
  const diagnosticDeltas = params.perFixture.filter(
    (fixture) =>
      fixture.diagnosticDelta !== "unchanged" &&
      fixture.diagnosticDelta !== "no-baseline",
  ).length;
  if (
    params.changedComponents.length === 0 &&
    outcomeDeltas === 0 &&
    diagnosticDeltas === 0
  ) {
    return "component attribution: comparable eval population with no observed component or fixture outcome deltas";
  }
  const componentList =
    params.changedComponents.length === 0
      ? "none"
      : params.changedComponents.join(", ");
  return `component attribution: changedComponents=${componentList}; fixtureOutcomeDeltas=${outcomeDeltas}; diagnosticDeltas=${diagnosticDeltas}`;
}

function baselineComparisonFor(
  priorBaseline: PersistedBaseline | null,
  candidate: EvalRunConfiguration,
): EvalRunConfigurationComparison | null {
  if (priorBaseline === null) return null;
  return priorBaseline.runConfiguration === undefined
    ? missingPriorRunConfigurationComparison(candidate)
    : compareRunConfigurations(priorBaseline.runConfiguration, candidate);
}

export function buildEvalComponentAttribution(params: {
  priorBaseline: PersistedBaseline | null;
  runs: readonly FixtureRun[];
  perFixture: readonly FixtureScore[];
  fixtureDiagnostics: FixtureDiagnosticsReport;
  objectiveMetrics: readonly AggregateObjectiveMetric[];
  codeHealth: CodeHealthAggregate;
  runConfiguration: EvalRunConfiguration;
  resourceProfile: ResourceProfile;
  executionProfile: ExecutionProfilePreflightResult;
  repeatCount: number;
  runArtifactBaseDir: string;
  runArtifactEvidence: readonly EvalFixtureRunAttributionEvidence[];
}): EvalComponentAttribution {
  const priorReport = readPriorReport(params.priorBaseline);
  const artifactEvidence = artifactEvidenceMap(params.runArtifactEvidence);
  const artifactSummaries = [...artifactEvidence.values()];
  const diagnostics = {
    verifierCalibration: diagnosticSummaryFromPerFixture(
      artifactSummaries,
      "verifierCalibration",
    ),
    trajectoryDiagnostics: diagnosticSummaryFromPerFixture(
      artifactSummaries,
      "trajectoryDiagnostics",
    ),
    contextRetrievalDiagnostics: diagnosticSummaryFromPerFixture(
      artifactSummaries,
      "contextRetrievalDiagnostics",
    ),
  };
  const comparison = baselineComparisonFor(
    params.priorBaseline,
    params.runConfiguration,
  );
  const baselineStatus: EvalAttributionBaselineStatus =
    comparison === null
      ? "no-baseline"
      : comparison.status === "comparable"
        ? "comparable"
        : "non-comparable";
  const perFixture = buildPerFixtureAttribution({
    currentDiagnostics: params.fixtureDiagnostics,
    currentMetrics: params.objectiveMetrics,
    artifactEvidence,
    priorReport,
    hasBaseline: params.priorBaseline !== null,
  });
  const components = buildComponents({
    priorReport,
    priorBaseline: params.priorBaseline,
    currentRuns: params.runs,
    currentRunConfiguration: params.runConfiguration,
    currentResourceProfile: params.resourceProfile,
    currentExecutionProfile: params.executionProfile,
    currentMetrics: params.objectiveMetrics,
    currentCodeHealth: params.codeHealth,
    artifactSummaries,
    diagnostics,
  });
  const changed = changedComponents(components, baselineStatus);
  return {
    schemaVersion: 1,
    summary: attributionSummary({
      baselineStatus,
      changedComponents: changed,
      perFixture,
    }),
    artifactPath: join(params.runArtifactBaseDir, "eval-set-report.json"),
    baseline: {
      status: baselineStatus,
      reason: comparison?.status === "mismatch" ? comparison.reason : null,
      priorRunArtifactBaseDir: params.priorBaseline?.runArtifactBaseDir ?? null,
      candidateRunArtifactBaseDir: params.runArtifactBaseDir,
      changedComponents: changed,
    },
    components,
    diagnostics,
    perFixture,
  };
}

export function toEvalComponentAttributionOperatorSummary(
  attribution: EvalComponentAttribution,
): EvalComponentAttributionOperatorSummary {
  return {
    summary: attribution.summary,
    artifactPath: attribution.artifactPath,
    baselineStatus: attribution.baseline.status,
    changedComponents: attribution.baseline.changedComponents,
  };
}

export function toEvalComponentAttributionAssessmentSummary(
  attribution: EvalComponentAttribution,
): EvalComponentAttributionAssessmentSummary {
  return toEvalComponentAttributionOperatorSummary(attribution);
}
