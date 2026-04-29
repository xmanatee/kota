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
  AgentPermissionResult,
  KotaAgentMessage,
} from "#core/agent-harness/types.js";
import type { SDKQueryOptions, SDKSystemPrompt } from "./sdk-types.js";

/**
 * Claude-agent-sdk-shaped permission and setting-source literals. The
 * neutral protocol no longer surfaces these names — they live on this
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

/**
 * Raw claude-agent-sdk frame the SDK iterator yields. The executor reads
 * these directly to extract turn count, session id, terminal result fields,
 * and verbose status output, then normalizes each frame to a
 * `KotaAgentMessage` before invoking the caller's `onMessage` callback.
 */
type RawSdkContentBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
};
type RawSdkMessage = {
  type: string;
  subtype?: string;
  session_id?: string;
  sessionId?: string;
  message?: { content?: RawSdkContentBlock[] } | string;
  content?: RawSdkContentBlock[];
  description?: string;
  output?: string[];
  tool_name?: string;
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
  is_error?: boolean;
  usage?: { input_tokens: number; output_tokens: number };
};

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
  permissionMode?: ClaudeAgentSdkPermissionMode;
  persistSession?: boolean;
  effort: AgentEffort;
  settingSources?: readonly ClaudeAgentSdkSettingSource[];
  pathToClaudeCodeExecutable?: string;
  abortController?: AbortController;
  enableFileCheckpointing?: boolean;
  onMessage?: (message: KotaAgentMessage) => void | Promise<void>;
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

function extractTextBlocks(blocks?: RawSdkContentBlock[]): string {
  if (!blocks) return "";
  return blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");
}

function extractMessageContent(message: RawSdkMessage): RawSdkContentBlock[] {
  if (Array.isArray(message.content)) return message.content;
  if (
    message.message &&
    typeof message.message === "object" &&
    Array.isArray((message.message as { content?: RawSdkContentBlock[] }).content)
  ) {
    return (message.message as { content?: RawSdkContentBlock[] }).content ?? [];
  }
  return [];
}

export function extractText(message: RawSdkMessage): string {
  return extractTextBlocks(extractMessageContent(message));
}

export function getSessionId(message: RawSdkMessage): string | undefined {
  return message.session_id ?? message.sessionId;
}

function extractStatusText(message: RawSdkMessage): string | null {
  if (
    message.type === "auth_status" &&
    Array.isArray(message.output) &&
    message.output.length > 0
  ) {
    return message.output.join(" ").trim();
  }
  if (typeof message.description === "string" && message.description) {
    return message.description;
  }
  if (typeof message.tool_name === "string" && message.tool_name) {
    return `${message.tool_name} running`;
  }
  if (typeof message.message === "string" && message.message) {
    return message.message;
  }
  const text = extractText(message);
  return text || null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize one raw SDK frame into one or more KOTA-native `KotaAgentMessage`
 * envelopes. An assistant frame with mixed content (`thinking`, `text`,
 * `tool_use`) fans out to one envelope per block so the neutral stream is a
 * strict discriminated union — no per-variant content arrays. Unrecognized
 * frame types fall through to a `status` envelope or the explicit `raw`
 * variant for adapter-specific shapes.
 */
function toKotaAgentMessages(message: RawSdkMessage): KotaAgentMessage[] {
  const sessionId = getSessionId(message);
  const withSession = <T extends KotaAgentMessage>(value: T): T =>
    sessionId !== undefined ? { ...value, sessionId } : value;

  if (message.type === "assistant") {
    const blocks = extractMessageContent(message);
    const out: KotaAgentMessage[] = [];
    for (const block of blocks) {
      if (block.type === "text" && typeof block.text === "string") {
        out.push(withSession({ type: "text", text: block.text }));
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        out.push(withSession({ type: "thinking", thinking: block.thinking }));
      } else if (
        block.type === "tool_use" &&
        typeof block.id === "string" &&
        typeof block.name === "string"
      ) {
        const input = isPlainRecord(block.input) ? block.input : {};
        out.push(
          withSession({
            type: "tool_call",
            toolUseId: block.id,
            toolName: block.name,
            input,
          }),
        );
      }
    }
    return out;
  }

  if (message.type === "user") {
    const blocks = extractMessageContent(message);
    const out: KotaAgentMessage[] = [];
    for (const block of blocks) {
      if (
        block.type === "tool_result" &&
        typeof block.tool_use_id === "string"
      ) {
        const rawContent = block.content;
        const content =
          typeof rawContent === "string"
            ? rawContent
            : Array.isArray(rawContent)
              ? JSON.stringify(rawContent)
              : "";
        out.push(
          withSession({
            type: "tool_result",
            toolUseId: block.tool_use_id,
            isError: block.is_error === true,
            content,
          }),
        );
      }
    }
    return out;
  }

  if (message.type === "result") {
    const text = typeof message.result === "string" ? message.result : undefined;
    return [
      withSession({
        type: "result",
        isError:
          message.is_error === true ||
          Boolean(message.subtype?.startsWith("error_")),
        ...(text !== undefined ? { text } : {}),
        ...(message.subtype !== undefined ? { subtype: message.subtype } : {}),
        ...(message.num_turns !== undefined ? { numTurns: message.num_turns } : {}),
        ...(message.total_cost_usd !== undefined
          ? { totalCostUsd: message.total_cost_usd }
          : {}),
        ...(message.usage?.input_tokens !== undefined
          ? { inputTokens: message.usage.input_tokens }
          : {}),
        ...(message.usage?.output_tokens !== undefined
          ? { outputTokens: message.usage.output_tokens }
          : {}),
      }),
    ];
  }

  const text = extractStatusText(message);
  return [
    withSession({
      type: "status",
      category: message.type,
      ...(message.subtype !== undefined ? { description: message.subtype } : {}),
      ...(message.tool_name !== undefined ? { toolName: message.tool_name } : {}),
      ...(message.output !== undefined ? { output: message.output } : {}),
      ...(text !== null ? { text } : {}),
    }),
  ];
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
    settingSources: options.settingSources
      ? [...options.settingSources]
      : undefined,
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

/**
 * Translate KOTA's neutral `decisionAttribution` literals into the
 * claude-agent-sdk's native `decisionClassification` literals so the SDK
 * sees the exact wire shape it expects. Adapters that route guards through
 * the SDK are the only seam where this mapping happens.
 */
type SdkDecisionClassification = "user_temporary" | "user_permanent" | "user_reject";

function attributionToSdk(
  attribution: AgentPermissionResult["decisionAttribution"],
): SdkDecisionClassification | undefined {
  switch (attribution) {
    case "operator-allow-once":
      return "user_temporary";
    case "operator-allow-always":
      return "user_permanent";
    case "operator-deny":
      return "user_reject";
    case undefined:
      return undefined;
  }
}

export function normalizePermissionResult(
  result: AgentPermissionResult,
  input: Record<string, unknown>,
): AgentPermissionResult {
  if (!isPlainRecord(result)) {
    throw new Error("SDK permission callback must return a permission decision object");
  }
  const behavior = result.behavior;

  if (behavior === "allow") {
    return {
      ...result,
      updatedInput: isPlainRecord(result.updatedInput) ? result.updatedInput : input,
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
  // Promise<PermissionResult>`); the adapter bridges field names
  // (`toolUseId` ↔ `toolUseID`, `decisionAttribution` ↔
  // `decisionClassification`) at this single seam.
  return (async (toolName, input, callbackOptions) => {
    const sdkContext = callbackOptions as {
      signal: AbortSignal;
      suggestions?: unknown[];
      blockedPath?: string;
      decisionReason?: string;
      title?: string;
      displayName?: string;
      description?: string;
      toolUseID: string;
      agentID?: string;
    };
    const decision = await canUseTool(toolName, input, {
      signal: sdkContext.signal,
      suggestions: sdkContext.suggestions,
      blockedPath: sdkContext.blockedPath,
      decisionReason: sdkContext.decisionReason,
      title: sdkContext.title,
      displayName: sdkContext.displayName,
      description: sdkContext.description,
      toolUseId: sdkContext.toolUseID,
      agentId: sdkContext.agentID,
    });
    const normalized = normalizePermissionResult(decision, input);
    const sdkResult: Record<string, unknown> = { ...normalized };
    if ("toolUseId" in sdkResult) {
      sdkResult.toolUseID = sdkResult.toolUseId;
      delete sdkResult.toolUseId;
    }
    if ("decisionAttribution" in sdkResult) {
      const sdkAttribution = attributionToSdk(
        normalized.decisionAttribution,
      );
      if (sdkAttribution !== undefined) {
        sdkResult.decisionClassification = sdkAttribution;
      }
      delete sdkResult.decisionAttribution;
    }
    return sdkResult as ReturnType<NonNullable<SDKQueryOptions["canUseTool"]>> extends Promise<infer R>
      ? R
      : never;
  }) as SDKQueryOptions["canUseTool"];
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
  if (abortSignal?.aborted) {
    const reason = abortSignal.reason;
    throw reason instanceof Error ? reason : new Error("Agent execution aborted");
  }

  for await (const rawMessage of sdkQuery({ prompt, options: queryOptions })) {
    if (abortSignal?.aborted) {
      const reason = abortSignal.reason;
      throw reason instanceof Error ? reason : new Error("Agent execution aborted");
    }

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
      // The SDK's `result` frame is the terminal message of the conversation
      // (one per `query()` call). Break instead of `continue` so we do not
      // wait for the iterator to close: under heavy throttling the SDK can
      // hang after emitting `result`, and the step-level watchdog would then
      // throw away the agent's already-completed work when its 3-hour
      // hang-rail fires. Breaking triggers `iterator.return()` for clean
      // teardown without blocking on more messages that will never arrive.
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
