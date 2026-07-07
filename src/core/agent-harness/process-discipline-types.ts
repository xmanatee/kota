import type {
  TrajectoryDiagnosticCode,
} from "./trajectory-diagnostics.js";

export const PROCESS_DISCIPLINE_RUBRIC_VERSION = "process-discipline-v1";

export const PROCESS_DISCIPLINE_DIMENSIONS = [
  "planning-fidelity",
  "verification-coverage",
  "recovery-efficiency",
  "abstention-quality",
  "atomic-transition-integrity",
] as const;

export type ProcessDisciplineDimension =
  (typeof PROCESS_DISCIPLINE_DIMENSIONS)[number];

export type ProcessDisciplineDimensionStatus =
  | "supported"
  | "unsupported"
  | "missing-evidence";

export type ProcessDisciplineGrade =
  | "excellent"
  | "good"
  | "caution"
  | "weak"
  | "unsupported";

export type ProcessDisciplineSourceKind =
  | "workflow-agent-step"
  | "harness-parity"
  | "trajectory-diagnostics";

export type ProcessDisciplineSourceRef = {
  kind: ProcessDisciplineSourceKind;
  artifactPath: string;
};

export type ProcessDisciplineEvidence = {
  code: TrajectoryDiagnosticCode | "abstention_outcome" | "clean";
  summary: string;
  details: readonly string[];
};

export type ProcessDisciplineAbstentionEvidence = {
  outcome: "no-op" | "blocked" | "unsupported";
  reason: string;
  artifactPath?: string;
};

export type ProcessDisciplineDimensionRecord = {
  dimension: ProcessDisciplineDimension;
  status: ProcessDisciplineDimensionStatus;
  score: number | null;
  maxScore: number;
  summary: string;
  reasons: readonly string[];
  evidence: readonly ProcessDisciplineEvidence[];
};

export type ProcessDisciplineAggregate = {
  score: number | null;
  maxScore: 100;
  grade: ProcessDisciplineGrade;
  supportedDimensions: number;
  missingEvidenceDimensions: number;
  unsupportedDimensions: number;
};

export type ProcessDisciplineRecord = {
  version: 1;
  rubricVersion: typeof PROCESS_DISCIPLINE_RUBRIC_VERSION;
  source: ProcessDisciplineSourceRef;
  aggregate: ProcessDisciplineAggregate;
  dimensions: readonly ProcessDisciplineDimensionRecord[];
};
