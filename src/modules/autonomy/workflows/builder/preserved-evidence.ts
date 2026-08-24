import { join } from "node:path";
import { inspectBuilderEvidenceForContinuation } from "./agent-run-evidence-policy.js";

export function findPreservedBuilderEvidenceRunId(
  workspaceDir: string,
  runId: string,
): string {
  const agentRunDir = join(workspaceDir, ".kota", "builder-evidence", runId);
  inspectBuilderEvidenceForContinuation(agentRunDir, workspaceDir);
  return runId;
}
