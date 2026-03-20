import { join } from "node:path";
import { readOptionalJsonFile } from "../../json-file.js";
import type { WorkflowRunMetadata, WorkflowStepContext } from "../../workflow/types.js";
import { loadRunsInWindow } from "../../workflow-history.js";
import { buildRuntimeState, loadChangedFiles, loadRecentCommits, type RunSummary, summarizeRun } from "../shared.js";

export type { RunSummary };

export type ImproverContext = {
  triggeringRun: RunSummary | null;
  changedFiles: string[];
  recentRuns: RunSummary[];
  recentCommits: string[];
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

  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  const recentRuns = loadRunsInWindow(runsDir, cutoffMs).slice(0, 20).map(summarizeRun);
  const recentCommits = loadRecentCommits(projectDir);
  const changedFiles = loadChangedFiles(projectDir);
  const runtimeState = buildRuntimeState(readRuntimeState());

  return { triggeringRun, changedFiles, recentRuns, recentCommits, runtimeState };
}
