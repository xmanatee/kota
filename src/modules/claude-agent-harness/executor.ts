import { spawn, spawnSync } from "node:child_process";
import type {
  McpServerConfig,
  SpawnedProcess,
  SpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentCanUseTool,
  AgentEffort,
  AgentMessage,
  AgentPermissionMode,
  AgentPermissionResult,
  AgentResultMessage,
  AgentSettingSource,
} from "#core/agent-harness/types.js";
import type { SDKQueryOptions, SDKSystemPrompt } from "./sdk-types.js";

/**
 * Claude-module-internal MCP server map: the harness-neutral transport
 * variants (`stdio | sse | http`) every harness reasons about, plus the
 * claude-agent-sdk in-process `sdk` variant this adapter hosts via
 * `createSdkMcpServer`. The adapter merges caller-supplied neutral entries
 * with its internal in-process servers (owner-questions today) before
 * handing the combined map to `query()`. Nothing in core references this
 * shape.
 */
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
  permissionMode?: AgentPermissionMode;
  persistSession?: boolean;
  effort: AgentEffort;
  settingSources?: AgentSettingSource[];
  pathToClaudeCodeExecutable?: string;
  abortController?: AbortController;
  enableFileCheckpointing?: boolean;
  onMessage?: (message: AgentMessage) => void | Promise<void>;
  thinkingEnabled?: boolean;
  thinkingBudget?: number;
  canUseTool?: AgentCanUseTool;
};

export const SDK_ABORT_FORCE_KILL_MS = 10_000;

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

function extractTextBlocks(blocks?: Array<{ type?: string; text?: string }>): string {
  if (!blocks) return "";
  return blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");
}

export function extractText(message: AgentMessage): string {
  if (message.type === "assistant") {
    if (message.message && typeof message.message === "object") {
      return extractTextBlocks(
        (message.message as { content?: Array<{ type?: string; text?: string }> }).content,
      );
    }
    if ("content" in message && Array.isArray(message.content)) {
      return extractTextBlocks(message.content);
    }
    return "";
  }

  if (
    "message" in message &&
    message.message &&
    typeof message.message === "object" &&
    !Array.isArray(message.message)
  ) {
    return extractTextBlocks((message.message as { content?: Array<{ type?: string; text?: string }> }).content);
  }

  return "";
}

export function getSessionId(message: AgentMessage): string | undefined {
  return message.session_id || message.sessionId;
}

function formatStatusMessage(message: AgentMessage): string | null {
  if (
    message.type === "auth_status" &&
    "output" in message &&
    Array.isArray(message.output) &&
    message.output.length > 0
  ) {
    return message.output.join(" ").trim();
  }
  if ("description" in message && typeof message.description === "string" && message.description) {
    return message.description;
  }
  if ("tool_name" in message && typeof message.tool_name === "string" && message.tool_name) {
    return `${message.tool_name} running`;
  }
  if ("message" in message && typeof message.message === "string" && message.message) {
    return message.message;
  }
  const text = extractText(message);
  return text || null;
}

export function detectLocalClaudeCodeExecutable(): string | undefined {
  const explicit = process.env.CLAUDE_CODE_EXECUTABLE?.trim();
  if (explicit) return explicit;

  const lookupCommand = process.platform === "win32" ? "where" : "which";
  for (const command of ["claude", "claude-code"]) {
    const result = spawnSync(lookupCommand, [command], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result?.status === 0) {
      const candidate = result.stdout.trim();
      if (candidate) return candidate;
    }
  }

  return undefined;
}

export function spawnClaudeCodeProcessWithAbortKill(
  options: SpawnOptions,
): SpawnedProcess {
  const stderrMode: "pipe" | "ignore" = options.env.DEBUG_CLAUDE_AGENT_SDK
    ? "pipe"
    : "ignore";
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env as NodeJS.ProcessEnv,
    signal: options.signal,
    stdio: ["pipe", "pipe", stderrMode],
    windowsHide: true,
  });

  if (child.stderr) {
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  }

  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  const clearForceKill = () => {
    if (forceKillTimer) {
      clearTimeout(forceKillTimer);
      forceKillTimer = undefined;
    }
    options.signal.removeEventListener("abort", scheduleForceKill);
  };
  const scheduleForceKill = () => {
    if (forceKillTimer) return;
    forceKillTimer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, SDK_ABORT_FORCE_KILL_MS);
    forceKillTimer.unref();
  };

  if (options.signal.aborted) scheduleForceKill();
  else options.signal.addEventListener("abort", scheduleForceKill, { once: true });
  child.once("exit", clearForceKill);
  child.once("error", clearForceKill);

  return child as SpawnedProcess;
}

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
    effort: options.effort,
    settingSources: options.settingSources,
    pathToClaudeCodeExecutable:
      options.pathToClaudeCodeExecutable ?? detectLocalClaudeCodeExecutable(),
    abortController: options.abortController,
    enableFileCheckpointing: options.enableFileCheckpointing,
    allowDangerouslySkipPermissions: permissionMode === "bypassPermissions",
    thinking,
    spawnClaudeCodeProcess: spawnClaudeCodeProcessWithAbortKill,
    canUseTool: normalizeCanUseTool(options.canUseTool),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizePermissionResult(
  result: AgentPermissionResult,
  input: Record<string, unknown>,
): AgentPermissionResult {
  if (!isRecord(result)) {
    throw new Error("SDK permission callback must return a permission decision object");
  }
  const behavior = result.behavior;

  if (behavior === "allow") {
    return {
      ...result,
      updatedInput: isRecord(result.updatedInput) ? result.updatedInput : input,
    };
  }

  if (behavior === "deny") {
    if (typeof result.message !== "string" || result.message.length === 0) {
      throw new Error("SDK permission denial must include a non-empty message");
    }
    return result;
  }

  throw new Error(`Unsupported SDK permission behavior: ${String(behavior)}`);
}

function normalizeCanUseTool(
  canUseTool: AgentCanUseTool | undefined,
): SDKQueryOptions["canUseTool"] | undefined {
  if (!canUseTool) return undefined;
  // The neutral `AgentCanUseTool` is structurally compatible with the SDK's
  // `CanUseTool` (same callsite contract — `(toolName, input, context) =>
  // Promise<PermissionResult>`); the adapter is the only place that bridges
  // the two type names, so the cast happens here once.
  return (async (toolName, input, callbackOptions) =>
    normalizePermissionResult(
      await canUseTool(toolName, input, callbackOptions),
      input,
    )) as SDKQueryOptions["canUseTool"];
}

export async function executeWithAgentSDK(
  prompt: string,
  options: ExecutorOptions,
  writer?: ExecutorWriter,
): Promise<ExecutorResult> {
  const out = writer ?? process.stdout;
  const queryOptions = buildQueryOptions(options);

  const streamedChunks: string[] = [];
  let resultMessage: AgentResultMessage | undefined;
  let sessionId: string | undefined;
  let turns = 0;
  const abortSignal = options.abortController?.signal;
  if (abortSignal?.aborted) {
    const reason = abortSignal.reason;
    throw reason instanceof Error ? reason : new Error("Agent execution aborted");
  }

  for await (const message of sdkQuery({ prompt, options: queryOptions })) {
    if (abortSignal?.aborted) {
      const reason = abortSignal.reason;
      throw reason instanceof Error ? reason : new Error("Agent execution aborted");
    }

    await options.onMessage?.(message);

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
      continue;
    }

    if (options.verbose) {
      const statusMessage = formatStatusMessage(message);
      if (statusMessage) process.stderr.write(`[agent-sdk] ${statusMessage}\n`);
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
