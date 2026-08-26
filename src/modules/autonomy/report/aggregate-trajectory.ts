import {
  DEFAULT_TRAJECTORY_DIAGNOSTIC_REPORT_LIMIT,
  detectRecurringTrajectoryDiagnosticPatterns,
} from "#modules/autonomy/trajectory-diagnostic-escalation.js";
import type { TrajectoryDiagnosticReport } from "./aggregate-types.js";

export function buildTrajectoryDiagnosticReport(
  runsDir: string,
  windowEndMs: number,
  windowMs: number,
): TrajectoryDiagnosticReport {
  const patterns = detectRecurringTrajectoryDiagnosticPatterns(runsDir, {
    nowMs: windowEndMs,
    windowMs,
  });
  return {
    activePatterns: patterns
      .slice(0, DEFAULT_TRAJECTORY_DIAGNOSTIC_REPORT_LIMIT)
      .map((pattern) => ({
        workflow: pattern.workflow,
        stepId: pattern.stepId,
        code: pattern.code,
        runCount: pattern.runCount,
        evidenceArtifactPaths: pattern.artifactPaths,
      })),
  };
}
