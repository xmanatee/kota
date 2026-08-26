import type { AgentHarnessResult } from "#core/agent-harness/index.js";
import { unpricedAgentUsage } from "#core/agent-harness/usage.js";

export function abortedAntigravityCliResult(): AgentHarnessResult {
  return {
    text: "Antigravity CLI run aborted.",
    streamedText: "",
    turns: 0,
    usage: unpricedAgentUsage(undefined, undefined),
    isError: true,
    subtype: "aborted",
  };
}
