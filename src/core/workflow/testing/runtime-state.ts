import type { WorkflowRuntimeSummary } from "../runtime-state-types.js";

/** Explicit empty history for focused executor tests without a run database. */
export function readEmptyTestWorkflowRuntimeState(): WorkflowRuntimeSummary {
  return { completedRuns: 0, workflows: {} };
}
