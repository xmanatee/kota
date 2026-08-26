import { join } from "node:path";
import type { PersistedBaseline } from "./baseline-state.js";
import type { PriorEvalSetReport } from "./eval-attribution-types.js";
import { readJsonFile } from "./eval-attribution-util.js";

export function readPriorReport(
  priorBaseline: PersistedBaseline | null,
): PriorEvalSetReport | null {
  if (priorBaseline === null) return null;
  const path = join(priorBaseline.runArtifactBaseDir, "eval-set-report.json");
  const report = readJsonFile<Partial<PriorEvalSetReport>>(path);
  if (
    report === null ||
    !Array.isArray(report.perFixture) ||
    report.fixtureDiagnostics === undefined ||
    !Array.isArray(report.objectiveMetrics) ||
    report.runConfiguration === undefined
  ) {
    return null;
  }
  return report as PriorEvalSetReport;
}
