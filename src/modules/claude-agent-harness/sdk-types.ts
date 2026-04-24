/**
 * Claude-agent-sdk-shaped wire types used only inside this adapter.
 *
 * The neutral wire frames every harness adapter normalizes into
 * (`AgentMessage`, `AgentPermissionMode`, `AgentSettingSource`) live in
 * `#core/agent-harness/types.js`. Everything declared here is the shape
 * the `@anthropic-ai/claude-agent-sdk` `query` function expects and is
 * therefore module-local — no other adapter or core code imports it.
 */

import type {
  CanUseTool,
  Options as ClaudeAgentSdkOptions,
  McpServerConfig,
  SpawnedProcess,
  SpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentMessage,
  AgentPermissionMode,
  AgentSettingSource,
} from "#core/agent-harness/types.js";

/**
 * Claude-agent-sdk's native `systemPrompt` wire type (string, string[], or the
 * `claude_code` preset envelope). Re-exported from the SDK so KOTA never
 * re-declares the `"claude_code"` literal. Only this adapter constructs
 * values of this shape; every other adapter consumes a plain
 * `AgentSystemPrompt` string.
 */
export type SDKSystemPrompt = NonNullable<ClaudeAgentSdkOptions["systemPrompt"]>;

export type SDKThinkingConfig =
  | { type: "adaptive" }
  | { type: "enabled"; budgetTokens?: number }
  | { type: "disabled" };

export type SDKQueryOptions = {
  model?: string;
  maxTurns?: number;
  systemPrompt?: SDKSystemPrompt;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: AgentPermissionMode;
  cwd?: string;
  persistSession?: boolean;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  includePartialMessages?: boolean;
  settingSources?: AgentSettingSource[];
  mcpServers?: Record<string, McpServerConfig>;
  pathToClaudeCodeExecutable?: string;
  allowDangerouslySkipPermissions?: boolean;
  abortController?: AbortController;
  enableFileCheckpointing?: boolean;
  thinking?: SDKThinkingConfig;
  spawnClaudeCodeProcess?: (options: SpawnOptions) => SpawnedProcess;
  canUseTool?: CanUseTool;
};

export type SDKQueryParams = {
  prompt: string;
  options?: SDKQueryOptions;
};

export type SDKQueryFn = (params: SDKQueryParams) => AsyncIterable<AgentMessage>;

export type SDKModule = {
  query: SDKQueryFn;
};
