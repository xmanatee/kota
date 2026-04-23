import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
  AgentMcpServers,
} from "#core/agent-harness/index.js";
import {
  createOwnerQuestionMcpServers,
  executeWithAgentSDK,
  KOTA_OWNER_QUESTIONS_MCP_SERVER,
  KOTA_OWNER_QUESTIONS_MCP_TOOL,
} from "#core/agent-sdk/index.js";
import type { SDKSystemPrompt } from "#core/agent-sdk/types.js";

export const CLAUDE_AGENT_HARNESS_NAME = "claude-agent-sdk";

const DEFAULT_SETTING_SOURCES: NonNullable<AgentHarnessRunOptions["settingSources"]> = ["project"];

function mergeOwnerQuestionsMcpServer(
  existing: AgentMcpServers | undefined,
  source: string,
): AgentMcpServers {
  // Owner-question injection must never overwrite caller-supplied MCP servers
  // (modules may have registered their own). If the caller already wired an
  // owner-questions server under this name, keep theirs; otherwise add ours.
  const owner = createOwnerQuestionMcpServers(source);
  if (existing === undefined) return owner;
  if (KOTA_OWNER_QUESTIONS_MCP_SERVER in existing) return existing;
  return { ...existing, ...owner };
}

/**
 * Wrap the harness-neutral portable prompt text in the claude-agent-sdk
 * `claude_code` preset envelope the SDK expects. The preset is claude-specific
 * wire shape — only this adapter knows the envelope exists; the rest of KOTA
 * hands around plain strings.
 */
function wrapSystemPromptForClaudeSDK(
  systemPrompt: string | undefined,
): SDKSystemPrompt {
  if (systemPrompt === undefined || systemPrompt.length === 0) {
    return { type: "preset", preset: "claude_code" };
  }
  return { type: "preset", preset: "claude_code", append: systemPrompt };
}

export const claudeAgentHarness: AgentHarness = {
  name: CLAUDE_AGENT_HARNESS_NAME,
  description:
    "Runs agent steps through Anthropic's @anthropic-ai/claude-agent-sdk loop with full tool access.",
  supportsMultiTurn: true,
  supportedHookKinds: ["preRun", "postRun"] as const,
  askOwnerToolName: KOTA_OWNER_QUESTIONS_MCP_TOOL,
  emitsAgentMessageStream: true,
  async run(
    options: AgentHarnessRunOptions,
    writer?: AgentHarnessWriter,
  ): Promise<AgentHarnessResult> {
    const { prompt, askOwner, settingSources, systemPrompt, ...rest } = options;
    const mcpServers = askOwner
      ? mergeOwnerQuestionsMcpServer(rest.mcpServers, askOwner.source)
      : rest.mcpServers;
    return executeWithAgentSDK(
      prompt,
      {
        ...rest,
        mcpServers,
        systemPrompt: wrapSystemPromptForClaudeSDK(systemPrompt),
        // Claude-SDK default: load project settings. Explicit caller values
        // (including an empty array meaning "load nothing") win.
        settingSources: settingSources ?? DEFAULT_SETTING_SOURCES,
      },
      writer,
    );
  },
};
