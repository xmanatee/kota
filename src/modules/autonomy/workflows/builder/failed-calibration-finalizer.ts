import type { WorkflowTerminalFinalizerInput } from "#core/workflow/types.js";
import { writeFailedCalibrationArtifact } from "#modules/autonomy/evaluator-calibration.js";

/** Record failed-run evaluator evidence without blocking worktree recovery. */
export function recordFailedBuilderCalibration(
  input: WorkflowTerminalFinalizerInput,
): void {
  try {
    const calibration = writeFailedCalibrationArtifact(input);
    if (calibration !== null) {
      input.log(
        `Recorded failed builder calibration for ${calibration.runId} (${calibration.verdict})`,
      );
    }
  } catch (error) {
    input.log(
      `Builder terminal finalizer could not record calibration: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
