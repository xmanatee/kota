import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
  AgentMcpServers,
} from "#core/agent-harness/index.js";
import { executeWithAgentSDK } from "./executor.js";
import {
  createOwnerQuestionMcpServers,
  KOTA_OWNER_QUESTIONS_MCP_SERVER,
  KOTA_OWNER_QUESTIONS_MCP_TOOL,
} from "./kota-tools-mcp.js";
import type { SDKSystemPrompt } from "./sdk-types.js";

export const CLAUDE_AGENT_HARNESS_NAME = "claude-agent-sdk";

const DEFAULT_SETTING_SOURCES: NonNullable<AgentHarnessRunOptions["settingSources"]> = ["project"];
// Workflow agent steps ran by this adapter skip the SDK permission prompt
// unless the step explicitly opts into a stricter mode via
// `WorkflowClaudeSdkStepOptions.permissionMode`. Declared inside the adapter
// so the neutral step protocol stays claude-SDK-free.
const DEFAULT_PERMISSION_MODE: NonNullable<AgentHarnessRunOptions["permissionMode"]> =
  "bypassPermissions";

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
    const { prompt, askOwner, settingSources, permissionMode, systemPrompt, ...rest } = options;
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
        // Workflow steps omit permissionMode on the neutral step shape; the
        // adapter applies the workflow-agent default here so autonomy
        // definitions do not re-state the field. Explicit caller values
        // (including `"default"` from passive autonomy mode) still win.
        permissionMode: permissionMode ?? DEFAULT_PERMISSION_MODE,
      },
      writer,
    );
  },
};
