import { join } from "node:path";
import { listStagedPaths } from "#modules/autonomy/commit-git.js";
import { inspectBuilderEvidence } from "./agent-run-evidence-policy.js";

const PROJECTED_EVIDENCE_PATH = /^\.kota\/runs\/([^/]+)\/evidence\//;

export function findPreservedBuilderEvidenceRunId(
  workspaceDir: string,
): string | null {
  const runIds = new Set<string>();
  for (const path of listStagedPaths(workspaceDir)) {
    const match = PROJECTED_EVIDENCE_PATH.exec(path);
    if (match?.[1]) runIds.add(match[1]);
  }
  if (runIds.size === 0) return null;
  if (runIds.size > 1) {
    throw new Error(
      `Preserved builder work contains multiple evidence lineages: ${[...runIds].sort().join(", ")}`,
    );
  }

  const runId = [...runIds][0]!;
  const agentRunDir = join(workspaceDir, ".kota", "builder-evidence", runId);
  inspectBuilderEvidence(agentRunDir, workspaceDir);
  return runId;
}
