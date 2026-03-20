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
  const changedFiles = loadChangedFiles(projectDir);
  const costByWorkflow = computeCostByWorkflow(recentRuns);
  const runtimeState = buildRuntimeState(readRuntimeState());

  return { triggeringRun, builtTaskId, changedFiles, recentRuns, recentCommits, costByWorkflow, runtimeState };
}
