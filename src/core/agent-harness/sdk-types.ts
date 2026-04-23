/**
 * Harness-neutral wire-frame and policy types every agent harness adapter
 * normalizes into. The shapes originated with the Claude Agent SDK but the
 * protocol treats them as neutral: workflow runtime, run stores, and step
 * executors consume them directly; non-claude adapters convert their native
 * payloads into these shapes at the boundary.
 *
 * Claude-SDK-specific query/option shapes (`SDKQueryOptions`, `SDKSystemPrompt`,
 * `SDKThinkingConfig`, `SDKQueryParams`, `SDKQueryFn`, `SDKModule`) live inside
 * `src/modules/claude-agent-harness/` because only that adapter builds them.
 */

export type SDKPermissionMode =
  | "default"
  | "acceptEdits"
  | "dontAsk"
  | "bypassPermissions";

export type SDKSettingSource = "project" | "local" | "user";

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
