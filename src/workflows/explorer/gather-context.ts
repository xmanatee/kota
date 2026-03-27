import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFlatFrontMatter } from "../../frontmatter.js";
import type { WorkflowStepContext } from "../../workflow/run-types.js";
import { buildRuntimeState, computeCostByWorkflow, loadRecentCommits, loadRecentRuns, type RunSummary } from "../shared.js";

export type { RunSummary };

export type TaskSummary = {
  id: string;
  title: string;
  summary: string;
  status: string;
  priority: string;
};

export type ExplorerContext = {
  needsAttention: boolean;
  taskCounts: Record<string, number>;
  openTaskSummaries: TaskSummary[];
  recentRuns: RunSummary[];
  recentCommits: string[];
  costByWorkflow: Record<string, number>;
  runtimeState: {
    completedRuns: number;
    workflows: Record<string, { lastStatus?: string; lastRunId?: string }>;
  };
};

function loadTaskSummaries(projectDir: string, states: string[]): TaskSummary[] {
  const summaries: TaskSummary[] = [];
  for (const state of states) {
    const dir = join(projectDir, "tasks", state);
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".md") || file === "AGENTS.md") continue;
      try {
        const raw = readFileSync(join(dir, file), "utf8");
        const { attrs } = parseFlatFrontMatter(raw);
        summaries.push({
          id: String(attrs.id ?? ""),
          title: String(attrs.title ?? ""),
          summary: String(attrs.summary ?? ""),
          status: String(attrs.status ?? state),
          priority: String(attrs.priority ?? ""),
        });
      } catch {
        // skip unreadable files
      }
    }
  }
  return summaries;
}

export function gatherExplorerContext(ctx: WorkflowStepContext): ExplorerContext {
  const { projectDir, stepOutputs, readRuntimeState } = ctx;
  const runsDir = join(projectDir, ".kota", "runs");

  const inspectOutput = stepOutputs["inspect-queue"];
  const needsAttention = Boolean(
    inspectOutput &&
      typeof inspectOutput === "object" &&
      "needsAttention" in inspectOutput &&
      (inspectOutput as Record<string, unknown>).needsAttention === true,
  );
  const taskCounts =
    inspectOutput &&
    typeof inspectOutput === "object" &&
    "counts" in inspectOutput
      ? ((inspectOutput as Record<string, unknown>).counts as Record<string, number>)
      : {};

  const openTaskSummaries = loadTaskSummaries(projectDir, ["ready", "backlog"]);
  const recentRuns = loadRecentRuns(runsDir);
  const recentCommits = loadRecentCommits(projectDir);
  const costByWorkflow = computeCostByWorkflow(recentRuns);
  const runtimeState = buildRuntimeState(readRuntimeState());

  return { needsAttention, taskCounts, openTaskSummaries, recentRuns, recentCommits, costByWorkflow, runtimeState };
}
