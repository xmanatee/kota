import type { CodeHealthAggregate } from "./code-health-diagnostics.js";
import type {
  ExecutionProfilePreflightResult,
  FixtureRun,
  ResourceProfile,
} from "./fixture-run.js";
import type { AggregateObjectiveMetric } from "./objective-metrics.js";
import type {
  EvalRunConfiguration,
  EvalRunConfigurationComparison,
} from "./run-configuration.js";
import type {
  FixtureDiagnostics,
  FixtureDiagnosticsReport,
  FixtureScore,
} from "./scoring.js";

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

export type PriorEvalSetReport = {
  perFixture: readonly FixtureScore[];
  fixtureDiagnostics: FixtureDiagnosticsReport;
  objectiveMetrics: readonly AggregateObjectiveMetric[];
  codeHealth: CodeHealthAggregate;
  runConfiguration: EvalRunConfiguration;
  resourceProfile: ResourceProfile;
  executionProfile: ExecutionProfilePreflightResult;
  componentAttribution?: EvalComponentAttribution;
};
