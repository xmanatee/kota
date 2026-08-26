import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  RunMetadataSnapshot,
  WorkflowRunMetadataSnapshot,
} from "./subprocess-executor-types.js";

function isTerminalRunStatus(status: string): boolean {
	return status !== "running";
}

function readRunSnapshot(path: string): {
	id: string;
	workflow: string;
	status: string;
} | null {
	try {
		const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
		const record = raw as Record<string, unknown>;
		return typeof record.id === "string" &&
			typeof record.workflow === "string" &&
			typeof record.status === "string"
			? { id: record.id, workflow: record.workflow, status: record.status }
			: null;
	} catch {
		return null;
	}
}

export function readWorkflowRunsForWorkflow(
  workingDir: string,
  workflowName: string,
): WorkflowRunMetadataSnapshot[] {
  const runsDir = join(workingDir, ".kota", "runs");
  if (!existsSync(runsDir)) return [];
  const entries = readdirSync(runsDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const snapshots: WorkflowRunMetadataSnapshot[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.includes(workflowName)) continue;
    const metadataPath = join(runsDir, entry.name, "metadata.json");
    if (!existsSync(metadataPath)) continue;
		const raw = readRunSnapshot(metadataPath);
    if (!raw) continue;
    if (raw.workflow !== workflowName) continue;
    if (typeof raw.status !== "string" || typeof raw.id !== "string") continue;
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
  const terminalRuns = readWorkflowRunsForWorkflow(workingDir, workflowName)
    .filter((run) => run.terminal && !existingRunIds.has(run.id));
  const terminal = terminalRuns[terminalRuns.length - 1];
  return terminal ? { id: terminal.id, status: terminal.status } : null;
}
