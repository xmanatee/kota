import {
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import type { PersistedBaseline } from "./baseline-store.js";
import type { CodeHealthAggregate } from "./code-health-diagnostics.js";
import type {
  ExecutionProfilePreflightResult,
  FixtureRun,
  FixtureRunExecutionMode,
  ResourceProfile,
} from "./fixture-run.js";
import { resourceProfilesComparable } from "./fixture-run.js";
import type { AggregateObjectiveMetric } from "./objective-metrics.js";
import {
  compareRunConfigurations,
  type EvalRunConfiguration,
  type EvalRunConfigurationComparison,
  missingPriorRunConfigurationComparison,
} from "./run-configuration.js";
import type {
  FixtureDiagnostics,
  FixtureDiagnosticsReport,
  FixtureScore,
} from "./scoring.js";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type EvalAttributionComponentId =
  | "model-preset"
  | "harness-execution"
  | "prompt-skill-context"
  | "fixture-verifier"
  | "environment-resource"
  | "feedback-loop";

export type EvalAttributionComponentStatus =
  | "stable"
  | "changed"
  | "missing"
  | "unsupported"
  | "diagnostic-delta";

export type EvalAttributionBaselineStatus =
  | "no-baseline"
  | "comparable"
  | "non-comparable";

export type EvalAttributionCodeCount = {
  code: string;
  count: number;
};

export type EvalAttributionDiagnosticSummary = {
  status: "present" | "missing";
  artifactCount: number;
  warningCount: number;
  codes: readonly EvalAttributionCodeCount[];
};

export type EvalFixtureArtifactEvidenceSummary = {
  runCount: number;
  childRunArtifactCount: number;
  predicateCount: number;
  failedPredicateCount: number;
  predicateKinds: readonly string[];
  verifierCalibration: EvalAttributionDiagnosticSummary;
  trajectoryDiagnostics: EvalAttributionDiagnosticSummary;
  contextRetrievalDiagnostics: EvalAttributionDiagnosticSummary;
};

export type EvalFixtureRunAttributionEvidence = {
  fixtureId: string;
  runIndex: number;
  childRunArtifactCount: number;
  predicateCount: number;
  failedPredicateCount: number;
  predicateKinds: readonly string[];
  verifierCalibration: EvalAttributionDiagnosticSummary;
  trajectoryDiagnostics: EvalAttributionDiagnosticSummary;
  contextRetrievalDiagnostics: EvalAttributionDiagnosticSummary;
};

export type EvalFixtureOutcomeAttribution = {
  outcomes: readonly FixtureRun["outcome"][];
  observedPassRate: number;
  diagnosticClass: FixtureDiagnostics["diagnosticClass"];
  warnings: readonly FixtureDiagnostics["warnings"][number][];
};

export type EvalFixtureObjectiveMetricDelta = {
  name: string;
  status: "no-baseline" | "missing-prior" | "unchanged" | "changed";
  priorMean: number | null;
  candidateMean: number;
  delta: number | null;
};

export type EvalFixtureAttributionSummary = {
  fixtureId: string;
  outcomeDelta:
    | "no-baseline"
    | "missing-prior"
    | "unchanged"
    | "improved"
    | "regressed"
    | "changed";
  diagnosticDelta: "no-baseline" | "missing-prior" | "unchanged" | "changed";
  prior: EvalFixtureOutcomeAttribution | null;
  candidate: EvalFixtureOutcomeAttribution;
  addedWarnings: readonly string[];
  removedWarnings: readonly string[];
  artifactEvidence: EvalFixtureArtifactEvidenceSummary;
  objectiveMetricDeltas: readonly EvalFixtureObjectiveMetricDelta[];
};

export type EvalAttributionComponentEntry = {
  id: EvalAttributionComponentId;
  label: string;
  status: EvalAttributionComponentStatus;
  summary: string;
  evidence: readonly string[];
  candidateExplanation: string | null;
};

export type EvalComponentAttribution = {
  schemaVersion: 1;
  summary: string;
  artifactPath: string;
  baseline: {
    status: EvalAttributionBaselineStatus;
    reason: EvalRunConfigurationComparison extends infer T
      ? T extends { status: "mismatch"; reason: infer R }
        ? R | null
        : null
      : null;
    priorRunArtifactBaseDir: string | null;
    candidateRunArtifactBaseDir: string;
    changedComponents: readonly EvalAttributionComponentId[];
  };
  components: readonly EvalAttributionComponentEntry[];
  diagnostics: {
    verifierCalibration: EvalAttributionDiagnosticSummary;
    trajectoryDiagnostics: EvalAttributionDiagnosticSummary;
    contextRetrievalDiagnostics: EvalAttributionDiagnosticSummary;
  };
  perFixture: readonly EvalFixtureAttributionSummary[];
};

export type EvalComponentAttributionOperatorSummary = {
  summary: string;
  artifactPath: string;
  baselineStatus: EvalAttributionBaselineStatus;
  changedComponents: readonly EvalAttributionComponentId[];
};

export type EvalComponentAttributionAssessmentSummary =
  EvalComponentAttributionOperatorSummary;

type PriorEvalSetReport = {
  perFixture: readonly FixtureScore[];
  fixtureDiagnostics: FixtureDiagnosticsReport;
  objectiveMetrics: readonly AggregateObjectiveMetric[];
  codeHealth: CodeHealthAggregate;
  runConfiguration: EvalRunConfiguration;
  resourceProfile: ResourceProfile;
  executionProfile: ExecutionProfilePreflightResult;
  componentAttribution?: EvalComponentAttribution;
};

type PredicateArtifactResult = {
  predicate?: { kind?: string };
  passed?: boolean;
};

type VerifierCalibrationArtifact = {
  passed?: boolean;
  cases?: readonly { id?: string; passed?: boolean }[];
  objectiveMetricComparisons?: readonly { name?: string; passed?: boolean }[];
};

type WorkflowExecutionArtifact = {
  runArtifactPath?: string | null;
};

type FixtureRunArtifactFile = {
  predicateResults?: readonly PredicateArtifactResult[];
  aggregatePredicateResults?: readonly PredicateArtifactResult[];
  preRunExpectationResults?: readonly PredicateArtifactResult[];
  verifierCalibration?: VerifierCalibrationArtifact;
  execution?: WorkflowExecutionArtifact;
  rounds?: readonly {
    execution?: WorkflowExecutionArtifact;
    predicateResults?: readonly PredicateArtifactResult[];
  }[];
  skillAblation?: {
    variants?: readonly {
      runArtifactPath?: string | null;
      predicateResults?: readonly PredicateArtifactResult[];
    }[];
  };
};

type TrajectoryDiagnosticsArtifactFile = {
  counts?: {
    warningCount?: number;
  };
  diagnostics?: readonly { code?: string }[];
};

type ContextRetrievalDiagnosticsArtifactFile = {
  counts?: {
    warningCount?: number;
  };
  warnings?: readonly { code?: string }[];
};

function stableStringify(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const objectValue = value as { readonly [key: string]: JsonValue };
  return `{${Object.keys(objectValue)
    .sort((a, b) => a.localeCompare(b))
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(objectValue[key] ?? null)}`,
    )
    .join(",")}}`;
}

function stableComparable(value: object): string {
  return stableStringify(JSON.parse(JSON.stringify(value)) as JsonValue);
}

function sameStructuredValue(a: object, b: object): boolean {
  return stableComparable(a) === stableComparable(b);
}

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function readPriorReport(
  priorBaseline: PersistedBaseline | null,
): PriorEvalSetReport | null {
  if (priorBaseline === null) return null;
  const path = join(priorBaseline.runArtifactBaseDir, "eval-set-report.json");
  const report = readJsonFile<Partial<PriorEvalSetReport>>(path);
  if (
    report === null ||
    !Array.isArray(report.perFixture) ||
    report.fixtureDiagnostics === undefined ||
    !Array.isArray(report.objectiveMetrics) ||
    report.runConfiguration === undefined
  ) {
    return null;
  }
  return report as PriorEvalSetReport;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function codeCounts(values: readonly string[]): readonly EvalAttributionCodeCount[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function emptyDiagnosticSummary(): EvalAttributionDiagnosticSummary {
  return {
    status: "missing",
    artifactCount: 0,
    warningCount: 0,
    codes: [],
  };
}

function mergeDiagnosticSummaries(
  summaries: readonly EvalAttributionDiagnosticSummary[],
): EvalAttributionDiagnosticSummary {
  if (summaries.length === 0) return emptyDiagnosticSummary();
  const codes = summaries.flatMap((summary) =>
    summary.codes.flatMap((entry) => Array.from({ length: entry.count }, () => entry.code)),
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

function verifierDiagnosticSummary(
  artifact: VerifierCalibrationArtifact | null,
): EvalAttributionDiagnosticSummary {
  if (artifact === null) return emptyDiagnosticSummary();
  const failedCases = (artifact.cases ?? []).filter(
    (entry) => entry.passed === false,
  );
  const failedMetrics = (artifact.objectiveMetricComparisons ?? []).filter(
    (entry) => entry.passed === false,
  );
  const codes = [
    ...failedCases.map((entry) => `case:${entry.id ?? "unknown"}`),
    ...failedMetrics.map((entry) => `metric:${entry.name ?? "unknown"}`),
  ];
  return {
    status: "present",
    artifactCount: 1,
    warningCount: artifact.passed === false ? Math.max(1, codes.length) : 0,
    codes: codeCounts(codes),
  };
}

function predicateKind(result: PredicateArtifactResult): string {
  return result.predicate?.kind ?? "unknown";
}

function childRunArtifactPath(path: string | null | undefined): string[] {
  return typeof path === "string" && path.length > 0 ? [path] : [];
}

function childArtifactPaths(payload: FixtureRunArtifactFile | null): readonly string[] {
  if (payload === null) return [];
  return uniqueSorted([
    ...childRunArtifactPath(payload.execution?.runArtifactPath),
    ...(payload.rounds ?? []).flatMap((round) =>
      childRunArtifactPath(round.execution?.runArtifactPath),
    ),
    ...(payload.skillAblation?.variants ?? []).flatMap((variant) =>
      childRunArtifactPath(variant.runArtifactPath),
    ),
  ]);
}

function allPredicateResults(
  payload: FixtureRunArtifactFile | null,
): readonly PredicateArtifactResult[] {
  if (payload === null) return [];
  return [
    ...(payload.predicateResults ?? []),
    ...(payload.aggregatePredicateResults ?? []),
    ...(payload.rounds ?? []).flatMap((round) => round.predicateResults ?? []),
    ...(payload.skillAblation?.variants ?? []).flatMap(
      (variant) => variant.predicateResults ?? [],
    ),
  ];
}

function findNamedFiles(
  root: string,
  names: readonly string[],
  maxDepth = 4,
): readonly string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const visit = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: Array<{
      name: string;
      isFile(): boolean;
      isDirectory(): boolean;
    }>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isFile() && names.includes(entry.name)) {
        found.push(path);
      } else if (entry.isDirectory()) {
        visit(path, depth + 1);
      }
    }
  };
  visit(root, 0);
  return uniqueSorted(found);
}

function readTrajectoryDiagnostics(
  childPaths: readonly string[],
): EvalAttributionDiagnosticSummary {
  const summaries = childPaths.flatMap((childPath) =>
    findNamedFiles(childPath, ["trajectory-diagnostics.json"]).map((path) => {
      const artifact = readJsonFile<TrajectoryDiagnosticsArtifactFile>(path);
      if (artifact === null) return emptyDiagnosticSummary();
      const codes = (artifact.diagnostics ?? [])
        .map((diagnostic) => diagnostic.code)
        .filter((code): code is string => typeof code === "string");
      return {
        status: "present" as const,
        artifactCount: 1,
        warningCount:
          typeof artifact.counts?.warningCount === "number"
            ? artifact.counts.warningCount
            : codes.length,
        codes: codeCounts(codes),
      };
    }),
  );
  return mergeDiagnosticSummaries(summaries);
}

function readContextRetrievalDiagnostics(
  childPaths: readonly string[],
): EvalAttributionDiagnosticSummary {
  const summaries = childPaths.flatMap((childPath) =>
    findNamedFiles(childPath, ["context-retrieval-diagnostics.json"]).map((path) => {
      const artifact = readJsonFile<ContextRetrievalDiagnosticsArtifactFile>(path);
      if (artifact === null) return emptyDiagnosticSummary();
      const codes = (artifact.warnings ?? [])
        .map((warning) => warning.code)
        .filter((code): code is string => typeof code === "string");
      return {
        status: "present" as const,
        artifactCount: 1,
        warningCount:
          typeof artifact.counts?.warningCount === "number"
            ? artifact.counts.warningCount
            : codes.length,
        codes: codeCounts(codes),
      };
    }),
  );
  return mergeDiagnosticSummaries(summaries);
}

export function collectFixtureRunAttributionEvidence(
  run: FixtureRun,
): EvalFixtureRunAttributionEvidence {
  const artifactPath = join(run.runArtifactPath, "fixture-run.json");
  const payload = readJsonFile<FixtureRunArtifactFile>(artifactPath);
  const predicates = allPredicateResults(payload);
  const childPaths = childArtifactPaths(payload);
  const verifier =
    payload?.verifierCalibration ??
    readJsonFile<VerifierCalibrationArtifact>(
      join(run.runArtifactPath, "verifier-calibration.json"),
    );
  return {
    fixtureId: run.fixtureId,
    runIndex: run.runIndex,
    childRunArtifactCount: childPaths.length,
    predicateCount: predicates.length,
    failedPredicateCount: predicates.filter((result) => result.passed === false)
      .length,
    predicateKinds: uniqueSorted(predicates.map(predicateKind)),
    verifierCalibration: verifierDiagnosticSummary(verifier ?? null),
    trajectoryDiagnostics: readTrajectoryDiagnostics(childPaths),
    contextRetrievalDiagnostics: readContextRetrievalDiagnostics(childPaths),
  };
}

function aggregateArtifactEvidence(
  evidence: readonly EvalFixtureRunAttributionEvidence[],
): readonly [string, EvalFixtureArtifactEvidenceSummary][] {
  const grouped = new Map<string, EvalFixtureRunAttributionEvidence[]>();
  for (const entry of evidence) {
    const bucket = grouped.get(entry.fixtureId);
    if (bucket) bucket.push(entry);
    else grouped.set(entry.fixtureId, [entry]);
  }
  return [...grouped.entries()]
    .map(([fixtureId, runs]) => {
      const summary: EvalFixtureArtifactEvidenceSummary = {
        runCount: runs.length,
        childRunArtifactCount: runs.reduce(
          (sum, run) => sum + run.childRunArtifactCount,
          0,
        ),
        predicateCount: runs.reduce((sum, run) => sum + run.predicateCount, 0),
        failedPredicateCount: runs.reduce(
          (sum, run) => sum + run.failedPredicateCount,
          0,
        ),
        predicateKinds: uniqueSorted(runs.flatMap((run) => run.predicateKinds)),
        verifierCalibration: mergeDiagnosticSummaries(
          runs.map((run) => run.verifierCalibration),
        ),
        trajectoryDiagnostics: mergeDiagnosticSummaries(
          runs.map((run) => run.trajectoryDiagnostics),
        ),
        contextRetrievalDiagnostics: mergeDiagnosticSummaries(
          runs.map((run) => run.contextRetrievalDiagnostics),
        ),
      };
      return [fixtureId, summary] as [string, EvalFixtureArtifactEvidenceSummary];
    })
    .sort(([a], [b]) => a.localeCompare(b));
}

function artifactEvidenceMap(
  evidence: readonly EvalFixtureRunAttributionEvidence[],
): Map<string, EvalFixtureArtifactEvidenceSummary> {
  return new Map(aggregateArtifactEvidence(evidence));
}

function diagnosticSummaryFromPerFixture(
  summaries: readonly EvalFixtureArtifactEvidenceSummary[],
  key:
    | "verifierCalibration"
    | "trajectoryDiagnostics"
    | "contextRetrievalDiagnostics",
): EvalAttributionDiagnosticSummary {
  return mergeDiagnosticSummaries(summaries.map((summary) => summary[key]));
}

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

function buildPerFixtureAttribution(params: {
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

function evidenceChanged(
  prior: EvalAttributionDiagnosticSummary | undefined,
  candidate: EvalAttributionDiagnosticSummary,
): boolean {
  if (prior === undefined) return false;
  return !sameStructuredValue(prior, candidate);
}

function promptSkillFacts(runs: readonly FixtureRun[]): {
  skillAblationRunCount: number;
  selectedSkills: readonly string[];
  failedPromptResolutionCount: number;
  unresolvedSkillCount: number;
} {
  let failedPromptResolutionCount = 0;
  let unresolvedSkillCount = 0;
  const selectedSkills: string[] = [];
  let skillAblationRunCount = 0;
  for (const run of runs) {
    if (run.skillAblation === undefined) continue;
    skillAblationRunCount += 1;
    for (const variant of run.skillAblation.variants) {
      selectedSkills.push(...variant.selectedSkills);
      if (!variant.promptResolution.passed) failedPromptResolutionCount += 1;
      unresolvedSkillCount += variant.promptResolution.resolvedSkills.filter(
        (skill) => !skill.resolved,
      ).length;
    }
  }
  return {
    skillAblationRunCount,
    selectedSkills: uniqueSorted(selectedSkills),
    failedPromptResolutionCount,
    unresolvedSkillCount,
  };
}

function fixtureManifestChanged(
  prior: PriorEvalSetReport | null,
  candidate: EvalRunConfiguration,
): boolean {
  return (
    prior !== null &&
    prior.runConfiguration.components.fixtureManifest.hash !==
      candidate.components.fixtureManifest.hash
  );
}

function tierEvidence(
  preset: EvalRunConfiguration["components"]["activePreset"],
): string {
  return [
    `fast:${preset.tiers.fast}`,
    `balanced:${preset.tiers.balanced}`,
    `capable:${preset.tiers.capable}`,
  ].join(",");
}

function executionModeEvidence(runs: readonly FixtureRun[]): string {
  const modes = uniqueSorted(
    runs.map((run): FixtureRunExecutionMode => run.executionMode ?? "live"),
  );
  return modes.join(",") || "unknown";
}

function timeoutEnvelopeEvidence(runs: readonly FixtureRun[]): string {
  if (runs.length === 0) {
    return "runs=0,budgetMs=none,maxDurationMs=0,deadlineHits=0,cleanReturns=0";
  }
  const budgets = runs.map((run) => run.timing.budgetMs);
  const durations = runs.map((run) => run.timing.durationMs);
  const minBudget = Math.min(...budgets);
  const maxBudget = Math.max(...budgets);
  const deadlineHits = runs.filter(
    (run) => run.outcome === "timeout" || run.timing.durationMs >= run.timing.budgetMs,
  ).length;
  const cleanReturns = runs.filter(
    (run) => run.outcome !== "timeout" && run.outcome !== "error",
  ).length;
  const budgetRange =
    minBudget === maxBudget ? String(minBudget) : `${minBudget}-${maxBudget}`;
  return `runs=${runs.length},budgetMs=${budgetRange},maxDurationMs=${Math.max(
    ...durations,
  )},deadlineHits=${deadlineHits},cleanReturns=${cleanReturns}`;
}

function networkPolicyEvidence(
  policy: ExecutionProfilePreflightResult["networkPolicy"],
): string {
  const endpoints =
    policy.allowedProviderEndpoints
      .map((endpoint) => `${endpoint.protocol}://${endpoint.host}:${endpoint.port}`)
      .join(",") || "none";
  if (policy.kind === "provider-egress") {
    return `${policy.kind}/${policy.provider}/${policy.enforcementMode}/endpoints=${endpoints}/gateEligible=${policy.gateEligible}`;
  }
  return `${policy.kind}/${policy.enforcementMode}/endpoints=${endpoints}/gateEligible=${policy.gateEligible}`;
}

function component(
  id: EvalAttributionComponentId,
  status: EvalAttributionComponentStatus,
  summary: string,
  evidence: readonly string[],
  candidateExplanation: string | null = null,
): EvalAttributionComponentEntry {
  const labels: { readonly [K in EvalAttributionComponentId]: string } = {
    "model-preset": "model and preset",
    "harness-execution": "harness adapter and execution path",
    "prompt-skill-context": "prompt, skill, and context inputs",
    "fixture-verifier": "fixture and verifier",
    "environment-resource": "environment and resources",
    "feedback-loop": "feedback loop",
  };
  return { id, label: labels[id], status, summary, evidence, candidateExplanation };
}

function componentStatus(
  hasBaseline: boolean,
  currentIssue: EvalAttributionComponentStatus | null,
  changed: boolean,
  diagnosticDelta = false,
): EvalAttributionComponentStatus {
  if (currentIssue !== null) return currentIssue;
  if (!hasBaseline) return "stable";
  if (diagnosticDelta) return "diagnostic-delta";
  return changed ? "changed" : "stable";
}

function buildComponents(params: {
  priorReport: PriorEvalSetReport | null;
  priorBaseline: PersistedBaseline | null;
  currentRuns: readonly FixtureRun[];
  currentRunConfiguration: EvalRunConfiguration;
  currentResourceProfile: ResourceProfile;
  currentExecutionProfile: ExecutionProfilePreflightResult;
  currentMetrics: readonly AggregateObjectiveMetric[];
  currentCodeHealth: CodeHealthAggregate;
  artifactSummaries: readonly EvalFixtureArtifactEvidenceSummary[];
  diagnostics: {
    verifierCalibration: EvalAttributionDiagnosticSummary;
    trajectoryDiagnostics: EvalAttributionDiagnosticSummary;
    contextRetrievalDiagnostics: EvalAttributionDiagnosticSummary;
  };
}): readonly EvalAttributionComponentEntry[] {
  const hasBaseline = params.priorBaseline !== null;
  const priorConfig =
    params.priorReport?.runConfiguration ?? params.priorBaseline?.runConfiguration;
  const currentModelEvidence =
    params.currentRunConfiguration.components.resolvedHarnessModelEvidence;
  const modelCurrentIssue =
    currentModelEvidence.status === "missing" ||
    currentModelEvidence.status === "mixed"
      ? "missing"
      : null;
  const modelChanged =
    priorConfig !== undefined &&
    (!sameStructuredValue(
      priorConfig.components.activePreset,
      params.currentRunConfiguration.components.activePreset,
    ) ||
      !sameStructuredValue(
        priorConfig.components.resolvedHarnessModelEvidence,
        currentModelEvidence,
      ));
  const harnessCurrentIssue =
    params.currentExecutionProfile.backendKind === "missing-isolation-backend" ||
    !params.currentExecutionProfile.gateEligible
      ? "unsupported"
      : null;
  const harnessChanged =
    priorConfig !== undefined &&
    (!sameStructuredValue(
      priorConfig.components.activePreset.harness === undefined
        ? { harness: "" }
        : { harness: priorConfig.components.activePreset.harness },
      { harness: params.currentRunConfiguration.components.activePreset.harness },
    ) ||
      !sameStructuredValue(
        priorConfig.components.executionProfile,
        params.currentRunConfiguration.components.executionProfile,
      ));
  const promptFacts = promptSkillFacts(params.currentRuns);
  const priorPromptDiagnostics =
    params.priorReport?.componentAttribution?.diagnostics.contextRetrievalDiagnostics;
  const promptDiagnosticDelta = evidenceChanged(
    priorPromptDiagnostics,
    params.diagnostics.contextRetrievalDiagnostics,
  );
  const priorVerifier =
    params.priorReport?.componentAttribution?.diagnostics.verifierCalibration;
  const verifierDiagnosticDelta =
    evidenceChanged(priorVerifier, params.diagnostics.verifierCalibration) ||
    (params.priorReport !== null &&
      !sameStructuredValue(params.priorReport.codeHealth, params.currentCodeHealth)) ||
    (params.priorReport !== null &&
      !sameStructuredValue(
        { names: params.priorReport.objectiveMetrics.map((metric) => metric.name).sort() },
        { names: params.currentMetrics.map((metric) => metric.name).sort() },
      ));
  const environmentDiagnosticDelta =
    params.priorReport !== null &&
    params.priorReport.executionProfile.diagnostics.length !==
      params.currentExecutionProfile.diagnostics.length;
  const priorTrajectory =
    params.priorReport?.componentAttribution?.diagnostics.trajectoryDiagnostics;
  const feedbackDiagnosticDelta =
    evidenceChanged(priorTrajectory, params.diagnostics.trajectoryDiagnostics) ||
    params.artifactSummaries.some((summary) => summary.failedPredicateCount > 0);
  const predicateKinds = uniqueSorted(
    params.artifactSummaries.flatMap((summary) => summary.predicateKinds),
  );
  const feedbackMissing =
    params.artifactSummaries.length === 0 ||
    params.currentRunConfiguration.components.resolvedHarnessModelEvidence.status ===
      "missing";

  return [
    component(
      "model-preset",
      componentStatus(hasBaseline, modelCurrentIssue, modelChanged),
      modelChanged
        ? "model, preset, or resolved harness/model evidence changed"
        : "model and preset evidence is recorded",
      [
        `activePreset=${params.currentRunConfiguration.summary.activePreset}`,
        `tierEvidence=${tierEvidence(
          params.currentRunConfiguration.components.activePreset,
        )}`,
        `resolvedHarnessModel=${params.currentRunConfiguration.summary.resolvedHarnessModelEvidence}`,
      ],
      modelChanged ? "candidate explanation: model population changed" : null,
    ),
    component(
      "harness-execution",
      componentStatus(hasBaseline, harnessCurrentIssue, harnessChanged),
      harnessChanged
        ? "harness adapter or execution path changed"
        : "harness adapter and execution path are recorded",
      [
        `harness=${params.currentRunConfiguration.components.activePreset.harness}`,
        `executionMode=${executionModeEvidence(params.currentRuns)}`,
        `executionProfile=${params.currentRunConfiguration.summary.executionProfile}`,
      ],
      harnessChanged
        ? "candidate explanation: adapter or execution backend changed"
        : null,
    ),
    component(
      "prompt-skill-context",
      componentStatus(
        hasBaseline,
        null,
        false,
        promptDiagnosticDelta ||
          promptFacts.failedPromptResolutionCount > 0 ||
          promptFacts.unresolvedSkillCount > 0,
      ),
      promptDiagnosticDelta
        ? "context-retrieval diagnostics changed"
        : "prompt, skill, and context evidence is bounded to declared artifacts",
      [
        `skillAblationRuns=${promptFacts.skillAblationRunCount}`,
        `selectedSkills=${promptFacts.selectedSkills.join(",") || "none"}`,
        `contextWarnings=${params.diagnostics.contextRetrievalDiagnostics.warningCount}`,
      ],
      promptDiagnosticDelta
        ? "candidate explanation: context-retrieval evidence changed"
        : null,
    ),
    component(
      "fixture-verifier",
      componentStatus(
        hasBaseline,
        null,
        fixtureManifestChanged(params.priorReport, params.currentRunConfiguration),
        verifierDiagnosticDelta,
      ),
      fixtureManifestChanged(params.priorReport, params.currentRunConfiguration)
        ? "fixture manifest changed"
        : verifierDiagnosticDelta
          ? "verifier, objective metric, or code-health diagnostics changed"
          : "fixture and verifier evidence is recorded",
      [
        `fixtureManifest=${params.currentRunConfiguration.summary.fixtureManifest}`,
        `verifierWarnings=${params.diagnostics.verifierCalibration.warningCount}`,
        `objectiveMetrics=${params.currentMetrics.length}`,
        `codeHealthWarnings=${params.currentCodeHealth.totalWarnings}`,
      ],
      verifierDiagnosticDelta
        ? "candidate explanation: fixture/verifier diagnostics changed"
        : null,
    ),
    component(
      "environment-resource",
      componentStatus(
        hasBaseline,
        params.currentExecutionProfile.gateEligible ? null : "unsupported",
        params.priorReport !== null &&
          (!resourceProfilesComparable(
            params.priorReport.resourceProfile,
            params.currentResourceProfile,
          ) ||
            !sameStructuredValue(
              params.priorReport.executionProfile,
              params.currentExecutionProfile,
            )),
        environmentDiagnosticDelta,
      ),
      environmentDiagnosticDelta
        ? "execution preflight diagnostics changed"
        : "resource profile and execution preflight are recorded",
      [
        `resourceProfile=${params.currentRunConfiguration.summary.resourceProfile}`,
        `executionProfile=${params.currentRunConfiguration.summary.executionProfile}`,
        `timeoutEnvelope=${timeoutEnvelopeEvidence(params.currentRuns)}`,
        `networkPolicy=${networkPolicyEvidence(
          params.currentExecutionProfile.networkPolicy,
        )}`,
        `preflightDiagnostics=${params.currentExecutionProfile.diagnostics.length}`,
      ],
      environmentDiagnosticDelta
        ? "candidate explanation: environment/preflight evidence changed"
        : null,
    ),
    component(
      "feedback-loop",
      componentStatus(
        hasBaseline,
        feedbackMissing ? "missing" : null,
        false,
        feedbackDiagnosticDelta,
      ),
      feedbackDiagnosticDelta
        ? "feedback-channel diagnostics changed"
        : "feedback channels are summarized from predicate and trajectory artifacts",
      [
        `predicateKinds=${predicateKinds.join(",") || "none"}`,
        `failedPredicates=${params.artifactSummaries.reduce(
          (sum, summary) => sum + summary.failedPredicateCount,
          0,
        )}`,
        `trajectoryWarnings=${params.diagnostics.trajectoryDiagnostics.warningCount}`,
      ],
      feedbackDiagnosticDelta
        ? "candidate explanation: feedback-loop evidence changed"
        : null,
    ),
  ];
}

function changedComponents(
  components: readonly EvalAttributionComponentEntry[],
  baselineStatus: EvalAttributionBaselineStatus,
): readonly EvalAttributionComponentId[] {
  if (baselineStatus === "no-baseline") return [];
  return components
    .filter((entry) =>
      entry.status === "changed" ||
      entry.status === "diagnostic-delta" ||
      entry.status === "missing" ||
      entry.status === "unsupported",
    )
    .map((entry) => entry.id);
}

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
