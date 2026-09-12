import { existsSync } from "node:fs";
import { join } from "node:path";
import { enumerateCompletedWorkflowRunMetadata, enumerateWorkflowRunMetadataWithDurableAuthority } from "#core/workflow/run-operational-projection.js";
import type {
  RunMetadataSnapshot,
  WorkflowRunMetadataSnapshot,
} from "./subprocess-executor-types.js";

function isTerminalRunStatus(status: string): boolean {
	return status !== "running";
}

export function readWorkflowRunsForWorkflow(
  workingDir: string,
  workflowName: string,
): WorkflowRunMetadataSnapshot[] {
  const runsDir = join(workingDir, ".kota", "runs");
  if (!existsSync(runsDir)) return [];
  const snapshots: WorkflowRunMetadataSnapshot[] = [];
  for (const raw of enumerateWorkflowRunMetadataWithDurableAuthority({
    runsDir,
    stateDir: join(workingDir, ".kota"),
    scopeRoot: workingDir,
  }).runs) {
    if (raw.workflow !== workflowName) continue;
    snapshots.push({
      id: raw.id,
      status: raw.status,
      terminal: isTerminalRunStatus(raw.status),
    });
  }
  return snapshots;
}

export function readTerminalRunForWorkflow(
  workingDir: string,
  workflowName: string,
  existingRunIds: ReadonlySet<string>,
): RunMetadataSnapshot | null {
  const terminalRuns = enumerateCompletedWorkflowRunMetadata({
    runsDir: join(workingDir, ".kota", "runs"),
    authority: { stateDir: join(workingDir, ".kota"), scopeRoot: workingDir },
  }).runs.filter((run) => run.workflow === workflowName && !existingRunIds.has(run.id));
  const terminal = terminalRuns[terminalRuns.length - 1];
  return terminal ? { id: terminal.id, status: terminal.status } : null;
}
