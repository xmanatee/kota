import { join } from "node:path";
import { readOptionalJsonFile } from "../../json-file.js";
import type { WorkflowRunMetadata, WorkflowStepContext } from "../../workflow/types.js";
import { buildRuntimeState, computeCostByWorkflow, loadChangedFiles, loadRecentCommits, loadRecentRuns, type RunSummary, summarizeRun } from "../shared.js";

export type { RunSummary };

export type ImproverContext = {
  triggeringRun: RunSummary | null;
  changedFiles: string[];
  recentRuns: RunSummary[];
  recentCommits: string[];
  costByWorkflow: Record<string, number>;
  runtimeState: {
    completedRuns: number;
    workflows: Record<string, { lastStatus?: string; lastRunId?: string }>;
  };
};

export function gatherImproverContext(ctx: WorkflowStepContext): ImproverContext {
  const { projectDir, trigger, readRuntimeState } = ctx;
  const runsDir = join(projectDir, ".kota", "runs");

  let triggeringRun: RunSummary | null = null;
  const runDir = trigger.payload.runDir;
  if (typeof runDir === "string") {
    const metadataPath = join(projectDir, runDir, "metadata.json");
    const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);
    if (metadata) triggeringRun = summarizeRun(metadata);
  }

  const recentRuns = loadRecentRuns(runsDir);
  const recentCommits = loadRecentCommits(projectDir);
  const changedFiles = loadChangedFiles(projectDir);
  const costByWorkflow = computeCostByWorkflow(recentRuns);
  const runtimeState = buildRuntimeState(readRuntimeState());

  return { triggeringRun, changedFiles, recentRuns, recentCommits, costByWorkflow, runtimeState };
}
