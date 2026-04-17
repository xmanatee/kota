import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

export type SDKPermissionMode =
  | "default"
  | "acceptEdits"
  | "dontAsk"
  | "bypassPermissions";

export type SDKSettingSource = "project" | "local" | "user";

export type SDKSystemPrompt =
  | string
  | {
      type: "preset";
      preset: "claude_code";
      append?: string;
    };

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
  permissionMode?: SDKPermissionMode;
  cwd?: string;
  persistSession?: boolean;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  includePartialMessages?: boolean;
  settingSources?: SDKSettingSource[];
  mcpServers?: Record<string, McpServerConfig>;
  pathToClaudeCodeExecutable?: string;
  allowDangerouslySkipPermissions?: boolean;
  abortController?: AbortController;
  enableFileCheckpointing?: boolean;
  thinking?: SDKThinkingConfig;
};

export type SDKContentBlock = {
  type: string;
  text?: string;
};

export type SDKMessageWithSession = {
  session_id?: string;
  sessionId?: string;
};

export type SDKAssistantMessage = SDKMessageWithSession & {
  type: "assistant";
  message?: {
    content?: SDKContentBlock[];
  };
  content?: SDKContentBlock[];
};

export type SDKResultMessage = SDKMessageWithSession & {
  type: "result";
  subtype?: string;
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
  is_error?: boolean;
  usage?: { input_tokens: number; output_tokens: number };
};

export type SDKStatusMessage = SDKMessageWithSession & {
  type: string;
  subtype?: string;
  message?: string | { content?: SDKContentBlock[] };
  description?: string;
  output?: string[];
  tool_name?: string;
};

export type SDKMessage =
  | SDKAssistantMessage
  | SDKResultMessage
  | SDKStatusMessage
  | (SDKMessageWithSession & Record<string, unknown> & { type: string });

export type SDKQueryParams = {
  prompt: string;
  options?: SDKQueryOptions;
};

export type SDKQueryFn = (params: SDKQueryParams) => AsyncIterable<SDKMessage>;

export type SDKModule = {
  query: SDKQueryFn;
};
