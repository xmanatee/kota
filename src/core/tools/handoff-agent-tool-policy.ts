import type { AgentToolPolicy } from "#core/agents/agent-types.js";
import { resolveAgentToolPolicy } from "#core/agents/handoff.js";
import { errorResult } from "./handoff-agent-input.js";
import type { ToolResult } from "./index.js";

export function buildAgentToolPolicy(
  agentPolicy: AgentToolPolicy | undefined,
  requestedToolPolicy: AgentToolPolicy,
): AgentToolPolicy | ToolResult {
  const toolPolicy = resolveAgentToolPolicy(agentPolicy, requestedToolPolicy);
  return toolPolicy.ok ? toolPolicy.policy : errorResult(toolPolicy.message);
}
