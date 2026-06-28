import type { AgentEffort } from "#core/agent-harness/index.js";

export const DEFAULT_EFFORT: AgentEffort = "xhigh";

export const TRACE_TAIL_LIMIT = 32_000;
export const DIFF_TAIL_LIMIT = 200_000;
export const TRAJECTORY_TOOL_RESULT_CONTENT_LIMIT = 8_000;
export const TRAJECTORY_ARTIFACT_NAME = "trajectory.json";
export const TRAJECTORY_SUMMARY_NAME = "trajectory-summary.md";
