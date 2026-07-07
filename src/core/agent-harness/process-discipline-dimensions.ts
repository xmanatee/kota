import {
  abstentionEvidence,
  cleanEvidence,
  codeCount,
  diagnosticEvidenceForCode,
} from "./process-discipline-evidence.js";
import type {
  ProcessDisciplineAbstentionEvidence,
  ProcessDisciplineDimension,
  ProcessDisciplineDimensionRecord,
  ProcessDisciplineEvidence,
} from "./process-discipline-types.js";
import type { TrajectoryDiagnosticCode } from "./trajectory-diagnostics.js";
import type { TrajectoryDiagnosticsProjectionArtifact } from "./trajectory-diagnostics-projection.js";

const DIMENSION_MAX_SCORE = 20;

type DiagnosticDimension = Exclude<
  ProcessDisciplineDimension,
  "abstention-quality"
>;

type DimensionSpec = {
  cleanSummary: string;
  warningCode?: TrajectoryDiagnosticCode;
  warningScore?: number;
};

export function buildDimensionRecord(
  dimension: ProcessDisciplineDimension,
  diagnostics: TrajectoryDiagnosticsProjectionArtifact,
  abstention: ProcessDisciplineAbstentionEvidence | undefined,
): ProcessDisciplineDimensionRecord {
  const unsupported = unsupportedRecord(dimension, diagnostics);
  if (unsupported !== null) return unsupported;
  const missingFrames = missingFramesRecord(dimension, diagnostics);
  if (missingFrames !== null) return missingFrames;
  if (dimension === "abstention-quality") {
    return buildAbstentionRecord(abstention);
  }
  return buildDiagnosticDimensionRecord(dimension, diagnostics);
}

function buildDiagnosticDimensionRecord(
  dimension: DiagnosticDimension,
  artifact: TrajectoryDiagnosticsProjectionArtifact,
): ProcessDisciplineDimensionRecord {
  const spec = dimensionSpec(dimension);
  const matching =
    spec.warningCode === undefined
      ? []
      : diagnosticEvidenceForCode(artifact, spec.warningCode);
  if (matching.length === 0) {
    return supportedRecord({
      dimension,
      score: DIMENSION_MAX_SCORE,
      summary: spec.cleanSummary,
      evidence: [cleanEvidence(spec.cleanSummary)],
    });
  }
  const warningCode = spec.warningCode;
  return supportedRecord({
    dimension,
    score: spec.warningScore ?? 0,
    summary: matching[0]!.summary,
    reasons: warningCode ? [warningCode] : [],
    evidence: matching,
  });
}

function buildAbstentionRecord(
  abstention: ProcessDisciplineAbstentionEvidence | undefined,
): ProcessDisciplineDimensionRecord {
  if (abstention === undefined) {
    return {
      dimension: "abstention-quality",
      status: "missing-evidence",
      score: null,
      maxScore: DIMENSION_MAX_SCORE,
      summary:
        "No no-op, blocked, or unsupported outcome evidence is available for abstention quality.",
      reasons: ["missing-abstention-outcome"],
      evidence: [],
    };
  }
  if (abstention.outcome === "unsupported") {
    return {
      dimension: "abstention-quality",
      status: "unsupported",
      score: null,
      maxScore: DIMENSION_MAX_SCORE,
      summary: "The run explicitly reported unsupported abstention evidence.",
      reasons: ["unsupported-abstention-outcome"],
      evidence: [abstentionEvidence(abstention)],
    };
  }
  return supportedRecord({
    dimension: "abstention-quality",
    score: DIMENSION_MAX_SCORE,
    summary: `The run reported an honest ${abstention.outcome} outcome.`,
    evidence: [abstentionEvidence(abstention)],
  });
}

function unsupportedRecord(
  dimension: ProcessDisciplineDimension,
  artifact: TrajectoryDiagnosticsProjectionArtifact,
): ProcessDisciplineDimensionRecord | null {
  if (
    artifact.status !== "unsupported" &&
    codeCount(artifact.counts, "unsupported_trajectory") === 0
  ) {
    return null;
  }
  const evidence = diagnosticEvidenceForCode(artifact, "unsupported_trajectory");
  return {
    dimension,
    status: "unsupported",
    score: null,
    maxScore: DIMENSION_MAX_SCORE,
    summary:
      "The trajectory artifact reports unsupported message-stream evidence.",
    reasons: ["unsupported-trajectory"],
    evidence,
  };
}

function missingFramesRecord(
  dimension: ProcessDisciplineDimension,
  artifact: TrajectoryDiagnosticsProjectionArtifact,
): ProcessDisciplineDimensionRecord | null {
  const evidence = diagnosticEvidenceForCode(artifact, "missing_streaming_frames");
  if (evidence.length === 0) return null;
  return {
    dimension,
    status: "missing-evidence",
    score: null,
    maxScore: DIMENSION_MAX_SCORE,
    summary:
      "The harness declared message streaming but emitted no trajectory frames.",
    reasons: ["missing-streaming-frames"],
    evidence,
  };
}

function supportedRecord(args: {
  dimension: ProcessDisciplineDimension;
  score: number;
  summary: string;
  reasons?: readonly string[];
  evidence: readonly ProcessDisciplineEvidence[];
}): ProcessDisciplineDimensionRecord {
  return {
    dimension: args.dimension,
    status: "supported",
    score: args.score,
    maxScore: DIMENSION_MAX_SCORE,
    summary: args.summary,
    reasons: args.reasons ?? [],
    evidence: args.evidence,
  };
}

function dimensionSpec(dimension: DiagnosticDimension): DimensionSpec {
  switch (dimension) {
    case "planning-fidelity":
      return {
        warningCode: "long_preamble_without_task_touch",
        warningScore: 10,
        cleanSummary:
          "No long pre-implementation tool sequence missed task-relevant changed files.",
      };
    case "verification-coverage":
      return {
        warningCode: "missing_final_verification_after_edit",
        cleanSummary:
          "File-editing activity was followed by a final verification-like signal.",
      };
    case "recovery-efficiency":
      return {
        warningCode: "repeated_identical_failing_command",
        cleanSummary:
          "No identical failing command was retried without an intervening edit.",
      };
    case "atomic-transition-integrity":
      return {
        warningCode: "edit_after_successful_verification",
        cleanSummary:
          "No post-verification edit occurred without fresh verification evidence.",
      };
  }
}
