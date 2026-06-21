import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractTaskProbe,
  rejectedTaskProbeResult,
  runTaskProbe,
  type TaskProbeResult,
  verifyTaskProbeProvenance,
} from "./task-probe.js";

export function runProbeIfDeclared(
  taskContent: string,
  taskPath: string,
  projectDir: string,
  runDir: string,
): TaskProbeResult | null {
  const probe = extractTaskProbe(taskContent);
  if (!probe) return null;

  const provenance = verifyTaskProbeProvenance({ projectDir, taskPath, probe });
  if (provenance.status === "untrusted") {
    const result = rejectedTaskProbeResult(probe, provenance.reason);
    writeFileSync(join(runDir, "runtime-probe.json"), JSON.stringify(result, null, 2));
    throw new Error(`Runtime Probe not executed: ${provenance.reason}`);
  }

  const result = {
    ...runTaskProbe(probe, projectDir),
    provenance,
  };
  writeFileSync(join(runDir, "runtime-probe.json"), JSON.stringify(result, null, 2));
  return result;
}
