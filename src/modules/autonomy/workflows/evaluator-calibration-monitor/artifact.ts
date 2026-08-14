import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CalibrationRepairApplied,
  CalibrationRepairArtifact,
  CalibrationRepairProposal,
} from "#modules/autonomy/calibration-repair.js";
import type { EvaluatorCalibrationInspection } from "./inspection.js";

export function writeCalibrationRepairArtifact(input: {
  runDirPath: string;
  inspection: EvaluatorCalibrationInspection;
  proposal: CalibrationRepairProposal;
  applied: CalibrationRepairApplied;
}): string {
  mkdirSync(input.runDirPath, { recursive: true });
  const artifactPath = join(input.runDirPath, "calibration-repair.json");
  const artifact: CalibrationRepairArtifact = {
    decisionReason: input.inspection.reason,
    driftKinds: input.inspection.driftKinds,
    proposal: input.proposal,
    applied: input.applied,
    aggregate: input.inspection.aggregate,
    thresholdRate: input.inspection.thresholdRate,
    passWithWarningsThresholdRate:
      input.inspection.passWithWarningsThresholdRate,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  return artifactPath;
}
