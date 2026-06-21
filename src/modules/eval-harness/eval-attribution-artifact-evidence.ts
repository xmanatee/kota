import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  codeCounts,
  emptyDiagnosticSummary,
  mergeDiagnosticSummaries,
} from "./eval-attribution-diagnostics.js";
import type {
  EvalAttributionDiagnosticSummary,
  EvalFixtureArtifactEvidenceSummary,
  EvalFixtureRunAttributionEvidence,
} from "./eval-attribution-types.js";
import { readJsonFile, uniqueSorted } from "./eval-attribution-util.js";
import type { FixtureRun } from "./fixture-run.js";

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

function childArtifactPaths(
  payload: FixtureRunArtifactFile | null,
): readonly string[] {
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
    findNamedFiles(childPath, ["context-retrieval-diagnostics.json"]).map(
      (path) => {
        const artifact = readJsonFile<ContextRetrievalDiagnosticsArtifactFile>(
          path,
        );
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
      },
    ),
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

export function artifactEvidenceMap(
  evidence: readonly EvalFixtureRunAttributionEvidence[],
): Map<string, EvalFixtureArtifactEvidenceSummary> {
  return new Map(aggregateArtifactEvidence(evidence));
}
