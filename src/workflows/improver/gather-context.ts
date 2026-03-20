import { join } from "node:path";
import { readOptionalJsonFile } from "../../json-file.js";
import type { WorkflowRunMetadata, WorkflowStepContext } from "../../workflow/types.js";
import { buildRuntimeState, computeCostByWorkflow, loadChangedFiles, loadRecentCommits, loadRecentRuns, type RunSummary, summarizeRun } from "../shared.js";

export type { RunSummary };

export type ImproverContext = {
  triggeringRun: RunSummary | null;
  builtTaskId: string | null;
  changedFiles: string[];
  recentRuns: RunSummary[];
  recentCommits: string[];
  costByWorkflow: Record<string, number>;
  runtimeState: {
    completedRuns: number;
    workflows: Record<string, { lastStatus?: string; lastRunId?: string }>;
  };
};

// Run IDs use format YYYY-MM-DDTHH-MM-SS-mmmZ-workflow-hash
// Convert back to ISO 8601 so git --after can parse it
function parseSinceTimestamp(runId: unknown): string | undefined {
  if (typeof runId !== "string") return undefined;
  const match = runId.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  if (!match) return undefined;
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
}

function extractBuiltTaskId(metadata: WorkflowRunMetadata): string | null {
  const claimStep = metadata.steps.find((s) => s.id === "claim-task");
  if (!claimStep || !claimStep.output || typeof claimStep.output !== "object") return null;
  const output = claimStep.output as Record<string, unknown>;
  return typeof output.chosenTaskId === "string" ? output.chosenTaskId : null;
}

export function gatherImproverContext(ctx: WorkflowStepContext): ImproverContext {
  const { projectDir, trigger, readRuntimeState } = ctx;
  const runsDir = join(projectDir, ".kota", "runs");

  let triggeringRun: RunSummary | null = null;
  let builtTaskId: string | null = null;
  const runDir = trigger.payload.runDir;
  if (typeof runDir === "string") {
    const metadataPath = join(projectDir, runDir, "metadata.json");
    const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);
    if (metadata) {
      triggeringRun = summarizeRun(metadata);
      builtTaskId = extractBuiltTaskId(metadata);
    }
  }

  const recentRuns = loadRecentRuns(runsDir);
  const recentCommits = loadRecentCommits(projectDir);
  const sinceTimestamp = parseSinceTimestamp(trigger.payload.runId);
  const changedFiles = loadChangedFiles(projectDir, sinceTimestamp);
  const costByWorkflow = computeCostByWorkflow(recentRuns);
  const runtimeState = buildRuntimeState(readRuntimeState());

  return { triggeringRun, builtTaskId, changedFiles, recentRuns, recentCommits, costByWorkflow, runtimeState };
}
