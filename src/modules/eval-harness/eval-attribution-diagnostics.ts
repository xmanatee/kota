import type {
  EvalAttributionCodeCount,
  EvalAttributionDiagnosticSummary,
  EvalFixtureArtifactEvidenceSummary,
} from "./eval-attribution-types.js";

export function codeCounts(
  values: readonly string[],
): readonly EvalAttributionCodeCount[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function emptyDiagnosticSummary(): EvalAttributionDiagnosticSummary {
  return {
    status: "missing",
    artifactCount: 0,
    warningCount: 0,
    codes: [],
  };
}

export function mergeDiagnosticSummaries(
  summaries: readonly EvalAttributionDiagnosticSummary[],
): EvalAttributionDiagnosticSummary {
  if (summaries.length === 0) return emptyDiagnosticSummary();
  const codes = summaries.flatMap((summary) =>
    summary.codes.flatMap((entry) =>
      Array.from({ length: entry.count }, () => entry.code),
    ),
  );
  const artifactCount = summaries.reduce(
    (sum, summary) => sum + summary.artifactCount,
    0,
  );
  return {
    status: artifactCount > 0 ? "present" : "missing",
    artifactCount,
    warningCount: summaries.reduce(
      (sum, summary) => sum + summary.warningCount,
      0,
    ),
    codes: codeCounts(codes),
  };
}

export function diagnosticSummaryFromPerFixture(
  summaries: readonly EvalFixtureArtifactEvidenceSummary[],
  key:
    | "verifierCalibration"
    | "trajectoryDiagnostics"
    | "contextRetrievalDiagnostics",
): EvalAttributionDiagnosticSummary {
  return mergeDiagnosticSummaries(summaries.map((summary) => summary[key]));
}
