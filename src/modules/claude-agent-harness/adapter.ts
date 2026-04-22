import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
} from "#core/agent-harness/index.js";
import { executeWithAgentSDK } from "#core/agent-sdk/index.js";

export const CLAUDE_AGENT_HARNESS_NAME = "claude-agent-sdk";

export const claudeAgentHarness: AgentHarness = {
  name: CLAUDE_AGENT_HARNESS_NAME,
  description:
    "Runs agent steps through Anthropic's @anthropic-ai/claude-agent-sdk loop with full tool access.",
  async run(
    options: AgentHarnessRunOptions,
    writer?: AgentHarnessWriter,
  ): Promise<AgentHarnessResult> {
    const { prompt, ...rest } = options;
    return executeWithAgentSDK(prompt, rest, writer);
  },
};
