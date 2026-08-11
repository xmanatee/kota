import type { AgentHarnessResult } from "#core/agent-harness/index.js";

export function abortedAntigravityCliResult(): AgentHarnessResult {
  return {
    text: "Antigravity CLI run aborted.",
    streamedText: "",
    turns: 0,
    isError: true,
    subtype: "aborted",
  };
}
