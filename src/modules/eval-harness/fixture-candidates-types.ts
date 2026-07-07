export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | JsonObject;

export type JsonObject = { readonly [key: string]: JsonValue | undefined };

export type FixtureCandidateStatus = "viable" | "needs-review" | "rejected";

export type FixtureCandidateDisposition =
  | "proposed"
  | "accepted"
  | "rejected"
  | "duplicate"
  | "needs-owner-evidence";

export type FixtureCandidatePatternKind =
  | "recurring-trajectory-warning"
  | "review-scrutiny-thin-acceptance"
  | "repair-loop-failure"
  | "workflow-schema-validation-failure"
  | "terminal-trace";

export type FixtureCandidateEvaluatorType =
  | "deterministic-predicate"
  | "artifact-schema-check"
  | "trajectory-check"
  | "model-graded-rubric"
  | "human-review-checklist";

export const FIXTURE_CANDIDATE_REASON_CODES = [
  "artifact-malformed",
  "duplicate-existing-fixture",
  "duplicate-existing-task",
  "operator-capture-required",
  "privacy-secret-like-value",
  "reproducibility-auth-walled",
  "reproducibility-host-specific",
  "reproducibility-network-bound",
  "safety-destructive-command",
  "trace-too-sparse",
  "verifier-no-state-signal",
] as const;

export type FixtureCandidateReasonCode =
  (typeof FIXTURE_CANDIDATE_REASON_CODES)[number];

export type FixtureCandidateCommand = {
  source: string;
  kind: "shell" | "process";
  command: string;
  risk: readonly FixtureCandidateReasonCode[];
};

export type FixtureCandidateStructuredArtifact = {
  path: string;
  kind: "json" | "jsonl" | "text";
  signal: string;
};

export type FixtureCandidatePattern = {
  kind: FixtureCandidatePatternKind;
  signature: string;
  title: string;
  summary: string;
  evidencePaths: readonly string[];
  occurrenceCount: number;
};

export type FixtureCandidateDuplicateReference = {
  kind: "fixture" | "task";
  id: string;
  path: string;
  state?: string;
  reason: string;
};

export type FixtureCandidateAcceptedAction = {
  kind: "task";
  id: string;
  path: string;
  state: "backlog";
};

export type FixtureCandidateSafety = {
  redactionCount: number;
  findings: readonly FixtureCandidateReasonCode[];
};

export type FixtureCandidateReproducibility = {
  localOnly: boolean;
  requiredServices: readonly string[];
  generatedArtifacts: readonly string[];
  hostAssumptions: readonly string[];
};

export type FixtureCandidateVerifierHints = {
  stateTargets: readonly string[];
  objectiveMetricCandidates: readonly string[];
  noOpChecks: readonly string[];
  partialAblationChecks: readonly string[];
};

export type FixtureCandidateRecord = {
  runId: string;
  workflow: string;
  runStatus: string;
  taskId: string | null;
  taskFinalState: string | null;
  status: FixtureCandidateStatus;
  disposition: FixtureCandidateDisposition;
  proposalFingerprint: string;
  failurePattern: FixtureCandidatePattern;
  reasonCodes: readonly FixtureCandidateReasonCode[];
  reasonSummary: string;
  preservationRationale: string;
  minimalFixtureInputs: readonly string[];
  suggestedEvaluator: FixtureCandidateEvaluatorType;
  terminalEvidence: {
    commandCount: number;
    commands: readonly FixtureCandidateCommand[];
    verificationCommands: readonly string[];
    taskStateMoves: readonly string[];
  };
  changedPaths: readonly string[];
  structuredArtifacts: readonly FixtureCandidateStructuredArtifact[];
  safety: FixtureCandidateSafety;
  reproducibility: FixtureCandidateReproducibility;
  verifierHints: FixtureCandidateVerifierHints;
  duplicateCoverage: {
    covered: boolean;
    fixtureIds: readonly string[];
    taskIds: readonly string[];
  };
  duplicateReferences: readonly FixtureCandidateDuplicateReference[];
  acceptedAction: FixtureCandidateAcceptedAction | null;
};

export type FixtureCandidateReport = {
  version: 1;
  input: {
    runsDir: string;
    runIds: readonly string[];
    workflow: string | null;
    limit: number;
    since: string | null;
    createTask: boolean;
  };
  dispositionTotals: Record<FixtureCandidateDisposition, number>;
  totals: {
    scannedRuns: number;
    viable: number;
    needsReview: number;
    rejected: number;
  };
  candidates: readonly FixtureCandidateRecord[];
};

export type FixtureCandidateMiningOptions = {
  runsDir?: string;
  outputDir: string;
  runIds?: readonly string[];
  workflow?: string;
  limit?: number;
  since?: string;
  createTask?: boolean;
  nowIso?: string;
};

export type FixtureCandidateMiningResult = {
  report: FixtureCandidateReport;
  jsonPath: string;
  summaryPath: string;
};

export type RunStepArtifact = {
  id: string;
  type: string;
  status: string;
  output: JsonValue | undefined;
  error: string | undefined;
};

export type RunMetadata = {
  id: string;
  workflow: string;
  status: string;
  startedAt: string | undefined;
  runDir: string | undefined;
  trigger: JsonObject | undefined;
  steps: readonly RunStepArtifact[];
};

export type RunSummaryArtifact = {
  taskId: string | null;
  taskTitle: string | null;
  filesChanged: readonly string[];
};

export type CalibrationArtifact = {
  taskId: string | null;
  taskFinalState: string | null;
  sourceFilesChanged: readonly string[];
};

export type DuplicateCoverage = {
  coveredRunIds: ReadonlyMap<string, readonly string[]>;
  taskReferencesByRunId: ReadonlyMap<string, readonly FixtureCandidateDuplicateReference[]>;
  taskReferencesByFingerprint: ReadonlyMap<string, readonly FixtureCandidateDuplicateReference[]>;
};

export type RunPatternSignal = {
  kind: FixtureCandidatePatternKind;
  signature: string;
  title: string;
  summary: string;
  evidencePaths: readonly string[];
  suggestedEvaluator: FixtureCandidateEvaluatorType;
};

export type RunEvidence = {
  runDir: string;
  metadata: RunMetadata;
  summary: RunSummaryArtifact | null;
  calibration: CalibrationArtifact | null;
  commands: readonly FixtureCandidateCommand[];
  changedPaths: readonly string[];
  structuredArtifacts: readonly FixtureCandidateStructuredArtifact[];
  malformedArtifacts: readonly FixtureCandidateStructuredArtifact[];
  taskStateMoves: readonly string[];
  operatorCaptureMentioned: boolean;
  patternSignals: readonly RunPatternSignal[];
};

export function stableUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}
