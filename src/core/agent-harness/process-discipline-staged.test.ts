import { describe, expect, it } from "vitest";
import { buildProcessDisciplineRecord } from "./process-discipline.js";
import type {
  TrajectoryDiagnosticCode,
  TrajectoryDiagnosticsCounts,
} from "./trajectory-diagnostics.js";
import type { TrajectoryDiagnosticsProjectionArtifact } from "./trajectory-diagnostics-projection.js";

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

function stagedArtifact(
  stages: readonly {
    stageId: string;
    codes: readonly TrajectoryDiagnosticCode[];
  }[],
  artifactRoot = "artifacts/codex",
): TrajectoryDiagnosticsProjectionArtifact {
  const allCodes = stages.flatMap((stage) => stage.codes);
  return {
    version: 1,
    status: "staged",
    counts: diagnosticCounts(allCodes),
    stages: stages.map((stage) => ({
      stageId: stage.stageId,
      diagnostics: {
        artifactPath: `${artifactRoot}/stages/${stage.stageId}/trajectory-diagnostics.json`,
        ...diagnosticCounts(stage.codes),
      },
    })),
  };
}

describe("buildProcessDisciplineRecord staged diagnostics", () => {
  it("projects staged harness-parity diagnostics from per-stage metadata", () => {
    const record = buildProcessDisciplineRecord({
      diagnostics: stagedArtifact([
        {
          stageId: "upgrade-v2",
          codes: ["missing_final_verification_after_edit"],
        },
        {
          stageId: "upgrade-v3",
          codes: ["repeated_identical_failing_command"],
        },
      ]),
      source: {
        kind: "harness-parity",
        artifactPath: "artifacts/codex/trajectory-diagnostics.json",
      },
    });

    expect(record.aggregate).toMatchObject({
      score: 50,
      grade: "weak",
      supportedDimensions: 4,
      missingEvidenceDimensions: 1,
    });
    expect(
      record.dimensions.find((entry) => entry.dimension === "verification-coverage"),
    ).toMatchObject({
      status: "supported",
      score: 0,
      reasons: ["missing_final_verification_after_edit"],
      evidence: [
        expect.objectContaining({
          code: "missing_final_verification_after_edit",
          details: [
            "stage=upgrade-v2",
            "count=1",
            "artifact=artifacts/codex/stages/upgrade-v2/trajectory-diagnostics.json",
          ],
        }),
      ],
    });
    expect(
      record.dimensions.find((entry) => entry.dimension === "recovery-efficiency"),
    ).toMatchObject({
      status: "supported",
      score: 0,
      reasons: ["repeated_identical_failing_command"],
    });
  });

  it("marks staged unsupported harness-parity diagnostics without a full diagnostics list", () => {
    const record = buildProcessDisciplineRecord({
      diagnostics: stagedArtifact(
        [
          { stageId: "upgrade-v2", codes: ["unsupported_trajectory"] },
          { stageId: "upgrade-v3", codes: ["unsupported_trajectory"] },
        ],
        "artifacts/thin",
      ),
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
    expect(record.dimensions[0]?.evidence[0]).toMatchObject({
      code: "unsupported_trajectory",
      details: [
        "stage=upgrade-v2",
        "count=1",
        "artifact=artifacts/thin/stages/upgrade-v2/trajectory-diagnostics.json",
      ],
    });
  });
});
