import type {
  ProcessDisciplineAbstentionEvidence,
  ProcessDisciplineEvidence,
} from "./process-discipline-types.js";
import type {
  TrajectoryDiagnostic,
  TrajectoryDiagnosticCode,
  TrajectoryDiagnosticsCounts,
} from "./trajectory-diagnostics.js";
import type { TrajectoryDiagnosticsProjectionArtifact } from "./trajectory-diagnostics-projection.js";

const STAGED_EVIDENCE_STAGE_LIMIT = 6;

export function diagnosticEvidenceForCode(
  artifact: TrajectoryDiagnosticsProjectionArtifact,
  code: TrajectoryDiagnosticCode,
): ProcessDisciplineEvidence[] {
  if (artifact.status !== "staged") {
    return artifact.diagnostics
      .filter((diagnostic) => diagnostic.code === code)
      .map(diagnosticEvidence);
  }

  const stageEvidence = artifact.stages
    .map((stage) => ({
      stageId: stage.stageId,
      artifactPath: stage.diagnostics.artifactPath,
      count: codeCount(stage.diagnostics, code),
    }))
    .filter((stage) => stage.count > 0);
  if (stageEvidence.length === 0) {
    const count = codeCount(artifact.counts, code);
    return count > 0 ? [stagedDiagnosticEvidence({ code, count })] : [];
  }

  return stageEvidence.slice(0, STAGED_EVIDENCE_STAGE_LIMIT).map((stage) =>
    stagedDiagnosticEvidence({
      code,
      count: stage.count,
      stageId: stage.stageId,
      artifactPath: stage.artifactPath,
      omittedStages: Math.max(0, stageEvidence.length - STAGED_EVIDENCE_STAGE_LIMIT),
    }),
  );
}

export function codeCount(
  counts: TrajectoryDiagnosticsCounts,
  code: TrajectoryDiagnosticCode,
): number {
  switch (code) {
    case "unsupported_trajectory":
      return counts.unsupportedTrajectoryCount;
    case "missing_streaming_frames":
      return counts.missingStreamingFramesCount;
    case "missing_final_verification_after_edit":
      return counts.missingFinalVerificationAfterEditCount;
    case "repeated_identical_failing_command":
      return counts.repeatedIdenticalFailingCommandCount;
    case "edit_after_successful_verification":
      return counts.editAfterSuccessfulVerificationCount;
    case "long_preamble_without_task_touch":
      return counts.longPreambleWithoutTaskTouchCount;
  }
}

export function cleanEvidence(summary: string): ProcessDisciplineEvidence {
  return {
    code: "clean",
    summary,
    details: [],
  };
}

export function abstentionEvidence(
  abstention: ProcessDisciplineAbstentionEvidence,
): ProcessDisciplineEvidence {
  return {
    code: "abstention_outcome",
    summary: abstention.reason,
    details: abstention.artifactPath ? [`artifact=${abstention.artifactPath}`] : [],
  };
}

function diagnosticEvidence(
  diagnostic: TrajectoryDiagnostic,
): ProcessDisciplineEvidence {
  return {
    code: diagnostic.code,
    summary: diagnostic.summary,
    details: [...diagnostic.details],
  };
}

function stagedDiagnosticEvidence(args: {
  code: TrajectoryDiagnosticCode;
  count: number;
  stageId?: string;
  artifactPath?: string;
  omittedStages?: number;
}): ProcessDisciplineEvidence {
  const details = [
    ...(args.stageId !== undefined ? [`stage=${args.stageId}`] : []),
    `count=${args.count}`,
    ...(args.artifactPath !== undefined ? [`artifact=${args.artifactPath}`] : []),
    ...(args.omittedStages !== undefined && args.omittedStages > 0
      ? [`omittedStages=${args.omittedStages}`]
      : []),
  ];
  return {
    code: args.code,
    summary: stagedDiagnosticSummary(args.code, args.count, args.stageId),
    details,
  };
}

function stagedDiagnosticSummary(
  code: TrajectoryDiagnosticCode,
  count: number,
  stageId: string | undefined,
): string {
  const prefix =
    stageId === undefined
      ? "The staged trajectory diagnostics"
      : `Stage ${stageId}`;
  return `${prefix} reported ${count} ${formatDiagnosticCode(code)} warning${
    count === 1 ? "" : "s"
  }.`;
}

function formatDiagnosticCode(code: TrajectoryDiagnosticCode): string {
  return code.replaceAll("_", " ");
}
