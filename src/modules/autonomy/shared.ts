import type { AgentDef } from "#core/agents/agent-types.js";
import {
  getPreset,
  resolveTierModel,
  SHIPPED_DEFAULT_PRESET_ID,
} from "#core/model/preset.js";
import type {
  WorkflowPredicate,
  WorkflowRunMetadata,
  WorkflowRunWarning,
} from "#core/workflow/run-types.js";
import { loadRunsInWindow } from "#modules/workflow-ops/runs/workflow-history.js";

export const READY_TASK_TARGET = 4;
export const BACKLOG_TASK_TARGET = 8;
export const AUTONOMY_DISALLOWED_TOOLS = ["Agent", "Task", "EnterWorktree", "ExitWorktree"];
export const AUTONOMY_AGENT_HANG_TIMEOUT_MS = 3 * 60 * 60 * 1000;
export const AUTONOMY_BUILDER_AGENT_IDLE_TIMEOUT_MS = 60 * 60 * 1000;
export const AUTONOMY_FULL_TEST_TIMEOUT_MS = 15 * 60 * 1000;
const AUTONOMY_AGENT_DEFINITION_PRESET = getPreset(SHIPPED_DEFAULT_PRESET_ID);

// Tier the autonomy fleet runs at. `tier: "capable"` is what every autonomy
// workflow agent step consumes; the workflow validator resolves it through
// the active preset's `tiers.capable`, so codex/gemini/claude all pick their
// own capable model without per-step edits.
export const AUTONOMY_AGENT_TIER = "capable" as const;

// Registry defaults keep agent declarations complete. Workflow compilation
// replaces this bundle from the active runtime whenever a step declares a
// portable tier.
function buildAutonomyAgentDefaults(): Pick<AgentDef, "model" | "effort"> & {
  tier: typeof AUTONOMY_AGENT_TIER;
} {
  return {
    tier: AUTONOMY_AGENT_TIER,
    model: resolveTierModel(AUTONOMY_AGENT_DEFINITION_PRESET, AUTONOMY_AGENT_TIER),
    effort: AUTONOMY_AGENT_DEFINITION_PRESET.defaultEffort,
  };
}

export const AUTONOMY_AGENT_DEFAULTS = buildAutonomyAgentDefaults();

export type RunSummary = {
  id: string;
  workflow: string;
  status: string;
  durationMs?: number;
  totalCostUsd?: number;
  warnings?: WorkflowRunWarning[];
};

export function summarizeRun(metadata: WorkflowRunMetadata): RunSummary {
  return {
    id: metadata.id,
    workflow: metadata.workflow,
    status: metadata.status,
    ...(metadata.durationMs != null ? { durationMs: metadata.durationMs } : {}),
    ...(metadata.totalCostUsd != null ? { totalCostUsd: metadata.totalCostUsd } : {}),
    ...(metadata.warnings != null ? { warnings: metadata.warnings } : {}),
  };
}

export function loadRecentRuns(runsDir: string): RunSummary[] {
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  return loadRunsInWindow(runsDir, cutoffMs).slice(0, 20).map(summarizeRun);
}

export function computeCostByWorkflow(runs: RunSummary[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const run of runs) {
    if (run.totalCostUsd != null) {
      result[run.workflow] = (result[run.workflow] ?? 0) + run.totalCostUsd;
    }
  }
  return result;
}

export function stepSucceeded(stepId: string): WorkflowPredicate {
  return ({ stepResults }) => stepResults[stepId]?.status === "success";
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
