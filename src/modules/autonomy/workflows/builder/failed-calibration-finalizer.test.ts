import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowTerminalFinalizerInput } from "#core/workflow/types.js";

const { writeFailedCalibrationArtifact } = vi.hoisted(() => ({
  writeFailedCalibrationArtifact: vi.fn(),
}));

vi.mock("#modules/autonomy/evaluator-calibration.js", () => ({
  writeFailedCalibrationArtifact,
}));

import { recordFailedBuilderCalibration } from "./failed-calibration-finalizer.js";

const trigger = { event: "task.ready", schemaRef: null, payload: {} } as const;

function finalizerInput(): WorkflowTerminalFinalizerInput {
  return {
    projectDir: "/tmp/project",
    workspaceDir: "/tmp/project",
    metadata: {
      id: "builder-run",
      workflow: "builder",
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      trigger,
      startedAt: "2026-08-13T11:59:00.000Z",
      completedAt: "2026-08-13T12:00:00.000Z",
      status: "failed",
      durationMs: 60_000,
      runDir: ".kota/runs/builder-run",
      steps: [],
    },
    trigger,
    emit: vi.fn(),
    log: vi.fn(),
  };
}

describe("recordFailedBuilderCalibration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs a persisted failed-run artifact", () => {
    const input = finalizerInput();
    writeFailedCalibrationArtifact.mockReturnValue({
      runId: "builder-run",
      verdict: "fail",
    });

    recordFailedBuilderCalibration(input);

    expect(input.log).toHaveBeenCalledWith(
      "Recorded failed builder calibration for builder-run (fail)",
    );
  });

  it("keeps terminal worktree recovery alive when calibration cannot be written", () => {
    const input = finalizerInput();
    writeFailedCalibrationArtifact.mockImplementation(() => {
      throw new Error("missing workspace evidence");
    });

    expect(() => recordFailedBuilderCalibration(input)).not.toThrow();
    expect(input.log).toHaveBeenCalledWith(
      "Builder terminal finalizer could not record calibration: missing workspace evidence",
    );
  });
});
