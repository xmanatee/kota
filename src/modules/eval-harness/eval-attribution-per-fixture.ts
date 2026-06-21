import { emptyDiagnosticSummary } from "./eval-attribution-diagnostics.js";
import type {
  EvalAttributionDiagnosticSummary,
  EvalFixtureArtifactEvidenceSummary,
  EvalFixtureAttributionSummary,
  EvalFixtureObjectiveMetricDelta,
  EvalFixtureOutcomeAttribution,
  PriorEvalSetReport,
} from "./eval-attribution-types.js";
import { sameStructuredValue } from "./eval-attribution-util.js";
import type { AggregateObjectiveMetric } from "./objective-metrics.js";
import type {
  FixtureDiagnostics,
  FixtureDiagnosticsReport,
} from "./scoring.js";

function fixtureOutcomeAttribution(
  diagnostic: FixtureDiagnostics,
): EvalFixtureOutcomeAttribution {
  return {
    outcomes: diagnostic.outcomes,
    observedPassRate: diagnostic.observedPassRate,
    diagnosticClass: diagnostic.diagnosticClass,
    warnings: diagnostic.warnings,
  };
}

function outcomeDelta(
  prior: EvalFixtureOutcomeAttribution | null,
  candidate: EvalFixtureOutcomeAttribution,
  hasBaseline: boolean,
): EvalFixtureAttributionSummary["outcomeDelta"] {
  if (!hasBaseline) return "no-baseline";
  if (prior === null) return "missing-prior";
  if (candidate.observedPassRate > prior.observedPassRate) return "improved";
  if (candidate.observedPassRate < prior.observedPassRate) return "regressed";
  if (candidate.outcomes.join(",") !== prior.outcomes.join(",")) return "changed";
  return "unchanged";
}

function warningDelta(
  prior: EvalFixtureOutcomeAttribution | null,
  candidate: EvalFixtureOutcomeAttribution,
  hasBaseline: boolean,
): {
  status: EvalFixtureAttributionSummary["diagnosticDelta"];
  added: readonly string[];
  removed: readonly string[];
} {
  if (!hasBaseline) return { status: "no-baseline", added: [], removed: [] };
  if (prior === null) return { status: "missing-prior", added: [], removed: [] };
  const priorWarnings = new Set(prior.warnings);
  const candidateWarnings = new Set(candidate.warnings);
  const added = candidate.warnings.filter((warning) => !priorWarnings.has(warning));
  const removed = prior.warnings.filter((warning) => !candidateWarnings.has(warning));
  const status =
    prior.diagnosticClass !== candidate.diagnosticClass ||
    added.length > 0 ||
    removed.length > 0
      ? "changed"
      : "unchanged";
  return { status, added, removed };
}

function diagnosticSummaryIsEmpty(
  summary: EvalAttributionDiagnosticSummary,
): boolean {
  return (
    summary.status === "missing" &&
    summary.artifactCount === 0 &&
    summary.warningCount === 0 &&
    summary.codes.length === 0
  );
}

function artifactDiagnosticsComparable(
  evidence: EvalFixtureArtifactEvidenceSummary,
): object {
  return {
    verifierCalibration: evidence.verifierCalibration,
    trajectoryDiagnostics: evidence.trajectoryDiagnostics,
    contextRetrievalDiagnostics: evidence.contextRetrievalDiagnostics,
  };
}

function artifactDiagnosticsAreEmpty(
  evidence: EvalFixtureArtifactEvidenceSummary,
): boolean {
  return (
    diagnosticSummaryIsEmpty(evidence.verifierCalibration) &&
    diagnosticSummaryIsEmpty(evidence.trajectoryDiagnostics) &&
    diagnosticSummaryIsEmpty(evidence.contextRetrievalDiagnostics)
  );
}

function artifactDiagnosticDelta(
  prior: EvalFixtureArtifactEvidenceSummary | undefined,
  candidate: EvalFixtureArtifactEvidenceSummary,
  hasBaseline: boolean,
): EvalFixtureAttributionSummary["diagnosticDelta"] {
  if (!hasBaseline) return "no-baseline";
  if (prior === undefined) {
    return artifactDiagnosticsAreEmpty(candidate) ? "unchanged" : "missing-prior";
  }
  return sameStructuredValue(
    artifactDiagnosticsComparable(prior),
    artifactDiagnosticsComparable(candidate),
  )
    ? "unchanged"
    : "changed";
}

function combineDiagnosticDelta(
  warningStatus: EvalFixtureAttributionSummary["diagnosticDelta"],
  artifactStatus: EvalFixtureAttributionSummary["diagnosticDelta"],
): EvalFixtureAttributionSummary["diagnosticDelta"] {
  if (warningStatus === "no-baseline" || artifactStatus === "no-baseline") {
    return "no-baseline";
  }
  if (warningStatus === "changed" || artifactStatus === "changed") {
    return "changed";
  }
  if (
    warningStatus === "missing-prior" ||
    artifactStatus === "missing-prior"
  ) {
    return "missing-prior";
  }
  return "unchanged";
}

function metricDeltas(
  fixtureId: string,
  currentMetrics: readonly AggregateObjectiveMetric[],
  priorMetrics: readonly AggregateObjectiveMetric[],
  hasBaseline: boolean,
): readonly EvalFixtureObjectiveMetricDelta[] {
  const priorByName = new Map(
    priorMetrics
      .filter((metric) => metric.fixtureId === fixtureId)
      .map((metric) => [metric.name, metric]),
  );
  return currentMetrics
    .filter((metric) => metric.fixtureId === fixtureId)
    .map((metric) => {
      const prior = priorByName.get(metric.name);
      if (!hasBaseline) {
        return {
          name: metric.name,
          status: "no-baseline" as const,
          priorMean: null,
          candidateMean: metric.mean,
          delta: null,
        };
      }
      if (prior === undefined) {
        return {
          name: metric.name,
          status: "missing-prior" as const,
          priorMean: null,
          candidateMean: metric.mean,
          delta: null,
        };
      }
      const delta = metric.mean - prior.mean;
      return {
        name: metric.name,
        status: delta === 0 ? "unchanged" as const : "changed" as const,
        priorMean: prior.mean,
        candidateMean: metric.mean,
        delta,
      };
    });
}

function emptyFixtureArtifactEvidence(): EvalFixtureArtifactEvidenceSummary {
  return {
    runCount: 0,
    childRunArtifactCount: 0,
    predicateCount: 0,
    failedPredicateCount: 0,
    predicateKinds: [],
    verifierCalibration: emptyDiagnosticSummary(),
    trajectoryDiagnostics: emptyDiagnosticSummary(),
    contextRetrievalDiagnostics: emptyDiagnosticSummary(),
  };
}

export function buildPerFixtureAttribution(params: {
  currentDiagnostics: FixtureDiagnosticsReport;
  currentMetrics: readonly AggregateObjectiveMetric[];
  artifactEvidence: Map<string, EvalFixtureArtifactEvidenceSummary>;
  priorReport: PriorEvalSetReport | null;
  hasBaseline: boolean;
}): readonly EvalFixtureAttributionSummary[] {
  const priorDiagnostics = new Map(
    (params.priorReport?.fixtureDiagnostics.perFixture ?? []).map((entry) => [
      entry.fixtureId,
      fixtureOutcomeAttribution(entry),
    ]),
  );
  const priorArtifactEvidence = new Map(
    (params.priorReport?.componentAttribution?.perFixture ?? []).map((entry) => [
      entry.fixtureId,
      entry.artifactEvidence,
    ]),
  );
  return params.currentDiagnostics.perFixture.map((diagnostic) => {
    const candidate = fixtureOutcomeAttribution(diagnostic);
    const prior = priorDiagnostics.get(diagnostic.fixtureId) ?? null;
    const warning = warningDelta(prior, candidate, params.hasBaseline);
    const artifactEvidence =
      params.artifactEvidence.get(diagnostic.fixtureId) ??
      emptyFixtureArtifactEvidence();
    const artifactStatus = artifactDiagnosticDelta(
      priorArtifactEvidence.get(diagnostic.fixtureId),
      artifactEvidence,
      params.hasBaseline,
    );
    return {
      fixtureId: diagnostic.fixtureId,
      outcomeDelta: outcomeDelta(prior, candidate, params.hasBaseline),
      diagnosticDelta: combineDiagnosticDelta(warning.status, artifactStatus),
      prior,
      candidate,
      addedWarnings: warning.added,
      removedWarnings: warning.removed,
      artifactEvidence,
      objectiveMetricDeltas: metricDeltas(
        diagnostic.fixtureId,
        params.currentMetrics,
        params.priorReport?.objectiveMetrics ?? [],
        params.hasBaseline,
      ),
    };
  });
}
