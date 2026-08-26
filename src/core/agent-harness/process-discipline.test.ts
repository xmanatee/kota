import { describe, expect, it } from "vitest";
import {
  buildProcessDisciplineRecord,
  PROCESS_DISCIPLINE_RUBRIC_VERSION,
  type ProcessDisciplineDimension,
} from "./process-discipline.js";
import type {
  TrajectoryDiagnostic,
  TrajectoryDiagnosticCode,
  TrajectoryDiagnosticsArtifact,
  TrajectoryDiagnosticsCounts,
} from "./trajectory-diagnostics.js";
import type { TrajectoryDiagnosticsProjectionArtifact } from "./trajectory-diagnostics-projection.js";

function diagnostic(code: TrajectoryDiagnosticCode): TrajectoryDiagnostic {
  return {
    code,
    severity: "warning",
    summary: `summary:${code}`,
    frameIndexes: [1],
    details: [`detail:${code}`],
  };
}

function diagnosticCounts(
  codes: readonly TrajectoryDiagnosticCode[],
): TrajectoryDiagnosticsCounts {
  return {
    warningCount: codes.length,
    unsupportedTrajectoryCount: codes.filter(
      (entry) => entry === "unsupported_trajectory",
    ).length,
    missingStreamingFramesCount: codes.filter(
      (entry) => entry === "missing_streaming_frames",
    ).length,
    missingFinalVerificationAfterEditCount: codes.filter(
      (entry) => entry === "missing_final_verification_after_edit",
    ).length,
    repeatedIdenticalFailingCommandCount: codes.filter(
      (entry) => entry === "repeated_identical_failing_command",
    ).length,
    editAfterSuccessfulVerificationCount: codes.filter(
      (entry) => entry === "edit_after_successful_verification",
    ).length,
    longPreambleWithoutTaskTouchCount: codes.filter(
      (entry) => entry === "long_preamble_without_task_touch",
    ).length,
  };
}

function artifact(
  diagnostics: readonly TrajectoryDiagnostic[] = [],
): TrajectoryDiagnosticsArtifact {
  const codes = diagnostics.map((entry) => entry.code);
  return {
    version: 1,
    status: "supported",
    emitsAgentMessageStream: true,
    counts: diagnosticCounts(codes),
    diagnostics,
  };
}

function unsupportedArtifact(): TrajectoryDiagnosticsArtifact {
  return {
    ...artifact([diagnostic("unsupported_trajectory")]),
    status: "unsupported",
    emitsAgentMessageStream: false,
  };
}

function dimension(
  artifactInput: TrajectoryDiagnosticsProjectionArtifact,
  name: ProcessDisciplineDimension,
) {
  const record = buildProcessDisciplineRecord({
    diagnostics: artifactInput,
    source: {
      kind: "trajectory-diagnostics",
      artifactPath: ".kota/runs/r1/steps/build.trajectory-diagnostics.json",
    },
  });
  return record.dimensions.find((entry) => entry.dimension === name);
}

describe("buildProcessDisciplineRecord", () => {
  it("scores a clean disciplined trajectory while marking abstention evidence missing", () => {
    const record = buildProcessDisciplineRecord({
      diagnostics: artifact(),
      source: {
        kind: "workflow-agent-step",
        artifactPath: ".kota/runs/r1/steps/build.trajectory-diagnostics.json",
      },
    });

    expect(record.rubricVersion).toBe(PROCESS_DISCIPLINE_RUBRIC_VERSION);
    expect(record.aggregate).toMatchObject({
      score: 100,
      grade: "good",
      supportedDimensions: 4,
      missingEvidenceDimensions: 1,
      unsupportedDimensions: 0,
    });
    expect(dimension(artifact(), "verification-coverage")).toMatchObject({
      status: "supported",
      score: 20,
    });
    expect(dimension(artifact(), "abstention-quality")).toMatchObject({
      status: "missing-evidence",
      score: null,
      reasons: ["missing-abstention-outcome"],
    });
  });

  it("projects missing final verification into the verification dimension", () => {
    const record = dimension(
      artifact([diagnostic("missing_final_verification_after_edit")]),
      "verification-coverage",
    );

    expect(record).toMatchObject({
      status: "supported",
      score: 0,
      reasons: ["missing_final_verification_after_edit"],
    });
    expect(record?.evidence[0]).toMatchObject({
      code: "missing_final_verification_after_edit",
      details: ["detail:missing_final_verification_after_edit"],
    });
  });

  it("projects repeated identical failing commands into recovery efficiency", () => {
    expect(
      dimension(
        artifact([diagnostic("repeated_identical_failing_command")]),
        "recovery-efficiency",
      ),
    ).toMatchObject({
      status: "supported",
      score: 0,
      reasons: ["repeated_identical_failing_command"],
    });
  });

  it("projects edit-after-pass warnings into atomic transition integrity", () => {
    expect(
      dimension(
        artifact([diagnostic("edit_after_successful_verification")]),
        "atomic-transition-integrity",
      ),
    ).toMatchObject({
      status: "supported",
      score: 0,
      reasons: ["edit_after_successful_verification"],
    });
  });

  it("marks unsupported native stream evidence without inventing scores", () => {
    const record = buildProcessDisciplineRecord({
      diagnostics: unsupportedArtifact(),
      source: {
        kind: "harness-parity",
        artifactPath: "artifacts/thin/trajectory-diagnostics.json",
      },
    });

    expect(record.aggregate).toMatchObject({
      score: null,
      grade: "unsupported",
      supportedDimensions: 0,
      unsupportedDimensions: 5,
    });
    expect(record.dimensions.every((entry) => entry.status === "unsupported")).toBe(
      true,
    );
  });

  it("scores concrete no-op or blocked abstention evidence", () => {
    const noop = buildProcessDisciplineRecord({
      diagnostics: artifact(),
      source: {
        kind: "workflow-agent-step",
        artifactPath: ".kota/runs/r1/steps/explore.trajectory-diagnostics.json",
      },
      abstention: {
        outcome: "no-op",
        reason: "Explorer reported no dependency-clear action.",
        artifactPath: ".kota/runs/r1/steps/explore.summary.md",
      },
    });
    const blocked = buildProcessDisciplineRecord({
      diagnostics: artifact(),
      source: {
        kind: "workflow-agent-step",
        artifactPath: ".kota/runs/r2/steps/build.trajectory-diagnostics.json",
      },
      abstention: {
        outcome: "blocked",
        reason: "Builder moved the task to blocked with a typed precondition.",
      },
    });

    expect(noop.aggregate.grade).toBe("excellent");
    expect(blocked.aggregate.grade).toBe("excellent");
    expect(
      noop.dimensions.find((entry) => entry.dimension === "abstention-quality"),
    ).toMatchObject({
      status: "supported",
      score: 20,
    });
  });
});
