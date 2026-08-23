import { join } from "node:path";
import { inspectBuilderEvidence } from "./agent-run-evidence-policy.js";

export function findPreservedBuilderEvidenceRunId(
  workspaceDir: string,
  runId: string,
): string {
  const agentRunDir = join(workspaceDir, ".kota", "builder-evidence", runId);
  inspectBuilderEvidence(agentRunDir, workspaceDir);
  return runId;
}
