import { spawnSync } from "node:child_process";
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type {
  SDKMessage,
  SDKPermissionMode,
  SDKQueryOptions,
  SDKResultMessage,
  SDKSystemPrompt,
} from "./types.js";

export type ExecutorWriter = { write(text: string): boolean };

export type ExecutorOptions = {
  model?: string;
  cwd?: string;
  verbose?: boolean;
  systemPrompt?: SDKSystemPrompt;
  maxTurns?: number;
  maxBudgetUsd?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: SDKPermissionMode;
  persistSession?: boolean;
  effort?: SDKQueryOptions["effort"];
  settingSources?: SDKQueryOptions["settingSources"];
  pathToClaudeCodeExecutable?: string;
  abortController?: AbortController;
  enableFileCheckpointing?: boolean;
  onMessage?: (message: SDKMessage) => void | Promise<void>;
  thinkingEnabled?: boolean;
  thinkingBudget?: number;
};

export type ExecutorResult = {
  text: string;
  streamedText: string;
  sessionId?: string;
  turns: number;
  totalCostUsd?: number;
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

export function extractText(message: SDKMessage): string {
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

export function getSessionId(message: SDKMessage): string | undefined {
  return message.session_id || message.sessionId;
}

function formatStatusMessage(message: SDKMessage): string | null {
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

export function buildQueryOptions(options?: ExecutorOptions): SDKQueryOptions {
  const permissionMode = options?.permissionMode ?? "bypassPermissions";
  const thinking = options?.thinkingEnabled
    ? { type: "enabled" as const, budgetTokens: Math.max(1024, options.thinkingBudget ?? 10_000) }
    : undefined;
  return {
    model: options?.model,
    maxTurns: options?.maxTurns,
    systemPrompt: options?.systemPrompt,
    allowedTools: options?.allowedTools,
    disallowedTools: options?.disallowedTools,
    permissionMode,
    cwd: options?.cwd ?? process.cwd(),
    maxBudgetUsd: options?.maxBudgetUsd,
    persistSession: options?.persistSession,
    effort: options?.effort ?? "max",
    settingSources: options?.settingSources,
    pathToClaudeCodeExecutable:
      options?.pathToClaudeCodeExecutable ?? detectLocalClaudeCodeExecutable(),
    abortController: options?.abortController,
    enableFileCheckpointing: options?.enableFileCheckpointing,
    allowDangerouslySkipPermissions: permissionMode === "bypassPermissions",
    thinking,
  };
}

export async function executeWithAgentSDK(
  prompt: string,
  options?: ExecutorOptions,
  writer?: ExecutorWriter,
): Promise<ExecutorResult> {
  const out = writer ?? process.stdout;
  const queryOptions = buildQueryOptions(options);

  const streamedChunks: string[] = [];
  let resultMessage: SDKResultMessage | undefined;
  let sessionId: string | undefined;
  let turns = 0;
  const abortSignal = options?.abortController?.signal;

  for await (const message of sdkQuery({ prompt, options: queryOptions })) {
    if (abortSignal?.aborted) {
      const reason = abortSignal.reason;
      throw reason instanceof Error ? reason : new Error("Agent execution aborted");
    }

    await options?.onMessage?.(message);

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

    if (options?.verbose) {
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
    subtype: resultMessage?.subtype,
    isError:
      resultMessage?.is_error === true ||
      Boolean(resultMessage?.subtype?.startsWith("error_")),
  };
}
