import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentCanUseTool,
  AgentEffort,
  KotaAgentMessage,
} from "#core/agent-harness/types.js";
import { normalizeCanUseTool } from "./executor-permissions.js";
import {
  detectLocalClaudeCodeExecutable,
  spawnClaudeCodeProcessWithAbortKill,
} from "./executor-process.js";
import {
  extractStatusText,
  extractText,
  getSessionId,
  type RawSdkMessage,
  toKotaAgentMessages,
} from "./executor-sdk-messages.js";
import type { SDKQueryOptions, SDKSystemPrompt } from "./sdk-types.js";

export { normalizePermissionResult } from "./executor-permissions.js";
export {
  detectLocalClaudeCodeExecutable,
  SDK_ABORT_FORCE_KILL_MS,
  spawnClaudeCodeProcessWithAbortKill,
} from "./executor-process.js";

/**
 * Claude-agent-sdk-shaped permission and setting-source literals. The
 * neutral protocol no longer surfaces these names; they live on this
 * adapter's per-step `harnessOptions["claude-agent-sdk"]` carve-out and
 * inside the SDK options the executor builds.
 */
export type ClaudeAgentSdkPermissionMode =
  | "default"
  | "acceptEdits"
  | "dontAsk"
  | "bypassPermissions";

export type ClaudeAgentSdkSettingSource = "project" | "local" | "user";

export type ClaudeAgentSdkStepOverrides = {
  permissionMode?: ClaudeAgentSdkPermissionMode;
  settingSources?: readonly ClaudeAgentSdkSettingSource[];
};

export type ClaudeAgentMcpServers = Record<string, McpServerConfig>;

export type ExecutorWriter = { write(text: string): boolean };

export type ExecutorOptions = {
  model?: string;
  cwd?: string;
  verbose?: boolean;
  systemPrompt?: SDKSystemPrompt;
  maxTurns?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: ClaudeAgentMcpServers;
  permissionMode?: ClaudeAgentSdkPermissionMode;
  persistSession?: boolean;
  resumeSessionId?: string;
  effort: AgentEffort;
  settingSources?: readonly ClaudeAgentSdkSettingSource[];
  pathToClaudeCodeExecutable?: string;
  env?: Record<string, string>;
  abortController?: AbortController;
  enableFileCheckpointing?: boolean;
  onMessage?: (message: KotaAgentMessage) => void | Promise<void>;
  thinkingEnabled?: boolean;
  thinkingBudget?: number;
  canUseTool?: AgentCanUseTool;
};

export type ExecutorResult = {
  text: string;
  streamedText: string;
  sessionId?: string;
  turns: number;
  totalCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  subtype?: string;
  isError: boolean;
};

export function buildQueryOptions(options: ExecutorOptions): SDKQueryOptions {
  const requestedPermissionMode = options.permissionMode ?? "bypassPermissions";
  const permissionMode =
    options.canUseTool && requestedPermissionMode === "bypassPermissions"
      ? "default"
      : requestedPermissionMode;
  const thinking = options.thinkingEnabled
    ? { type: "enabled" as const, budgetTokens: Math.max(1024, options.thinkingBudget ?? 10_000) }
    : undefined;
  return {
    model: options.model,
    maxTurns: options.maxTurns,
    systemPrompt: options.systemPrompt,
    allowedTools: options.allowedTools,
    disallowedTools: options.disallowedTools,
    mcpServers: options.mcpServers,
    permissionMode,
    cwd: options.cwd ?? process.cwd(),
    persistSession: options.persistSession,
    resume: options.resumeSessionId,
    effort: options.effort,
    settingSources: options.settingSources
      ? [...options.settingSources]
      : undefined,
    pathToClaudeCodeExecutable:
      options.pathToClaudeCodeExecutable ?? detectLocalClaudeCodeExecutable(),
    ...(options.env !== undefined
      ? { env: { ...stringProcessEnv(), ...options.env } }
      : {}),
    abortController: options.abortController,
    enableFileCheckpointing: options.enableFileCheckpointing,
    allowDangerouslySkipPermissions: permissionMode === "bypassPermissions",
    thinking,
    spawnClaudeCodeProcess: spawnClaudeCodeProcessWithAbortKill,
    canUseTool: normalizeCanUseTool(options.canUseTool),
  };
}

function stringProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function throwIfAborted(abortSignal: AbortSignal | undefined): void {
  if (!abortSignal?.aborted) return;
  const reason = abortSignal.reason;
  throw reason instanceof Error ? reason : new Error("Agent execution aborted");
}

export async function executeWithAgentSDK(
  prompt: string,
  options: ExecutorOptions,
  writer?: ExecutorWriter,
): Promise<ExecutorResult> {
  const out = writer ?? process.stdout;
  const queryOptions = buildQueryOptions(options);

  const streamedChunks: string[] = [];
  let resultMessage: RawSdkMessage | undefined;
  let sessionId: string | undefined;
  let turns = 0;
  const abortSignal = options.abortController?.signal;
  throwIfAborted(abortSignal);

  for await (const rawMessage of sdkQuery({ prompt, options: queryOptions })) {
    throwIfAborted(abortSignal);

    const message = rawMessage as RawSdkMessage;

    if (options.onMessage) {
      for (const frame of toKotaAgentMessages(message)) {
        await options.onMessage(frame);
      }
    }

    const messageSessionId = getSessionId(message);
    if (messageSessionId) sessionId = messageSessionId;

    if (message.type === "assistant") {
      turns += 1;
      const text = extractText(message);
      if (text) {
        out.write(text);
        streamedChunks.push(text);
      }
      continue;
    }

    if (message.type === "result") {
      resultMessage = message;
      if (typeof message.num_turns === "number") turns = message.num_turns;
      break;
    }

    if (options.verbose) {
      const statusText = extractStatusText(message);
      if (statusText) process.stderr.write(`[agent-sdk] ${statusText}\n`);
    }
  }

  const streamedText = streamedChunks.join("");
  const text = resultMessage?.result ?? streamedText;

  return {
    text,
    streamedText,
    sessionId,
    turns,
    totalCostUsd: resultMessage?.total_cost_usd,
    inputTokens: resultMessage?.usage?.input_tokens,
    outputTokens: resultMessage?.usage?.output_tokens,
    subtype: resultMessage?.subtype,
    isError:
      resultMessage?.is_error === true ||
      Boolean(resultMessage?.subtype?.startsWith("error_")),
  };
}
