import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type {
  SDKMessage,
  SDKPermissionMode,
  SDKQueryOptions,
  SDKSettingSource,
} from "#core/agent-sdk/types.js";
import type { HarnessHookKind } from "./hooks.js";

/**
 * Harness-neutral re-exports. Message, permission, and settings shapes live in
 * `src/core/agent-sdk/types.ts` because they originated with the Claude Agent
 * SDK, but the protocol treats them as neutral wire types every harness adapter
 * must read or produce. Non-claude adapters convert between their native
 * payloads and these shapes at the boundary.
 */
export type AgentMessage = SDKMessage;
export type AgentPermissionMode = SDKPermissionMode;
export type AgentSettingSource = SDKSettingSource;
/**
 * Portable system-prompt text every harness-neutral caller delivers. Adapters
 * that wrap prompts in a native envelope (e.g. the claude-agent-sdk
 * `claude_code` preset) do the wrapping inside the adapter; the protocol
 * surface is a plain string.
 */
export type AgentSystemPrompt = string;
export type AgentCanUseTool = CanUseTool;
export type AgentPermissionResult = PermissionResult;
export type AgentMcpServers = SDKQueryOptions["mcpServers"];
export type AgentEffort = NonNullable<SDKQueryOptions["effort"]>;

/**
 * Declares that a run should expose the `ask_owner` tool to the agent so it
 * can escalate high-stakes decisions to the repo owner. Every adapter that
 * can host a tool loop must honor this; adapters that cannot (text-only
 * runners) reject it at the boundary. `source` is threaded into the owner
 * question queue so operators can trace which agent run raised which
 * question.
 */
export type AgentAskOwnerOptions = {
  source: string;
};

export type AgentHarnessWriter = { write(text: string): boolean };

export type AgentHarnessRunOptions = {
  prompt: string;
  model?: string;
  cwd?: string;
  verbose?: boolean;
  systemPrompt?: AgentSystemPrompt;
  maxTurns?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: AgentMcpServers;
  permissionMode?: AgentPermissionMode;
  persistSession?: boolean;
  effort: AgentEffort;
  settingSources?: AgentSettingSource[];
  abortController?: AbortController;
  enableFileCheckpointing?: boolean;
  onMessage?: (message: AgentMessage) => void | Promise<void>;
  thinkingEnabled?: boolean;
  thinkingBudget?: number;
  canUseTool?: AgentCanUseTool;
  /**
   * Harness-neutral request to expose the owner-questions escalation tool to
   * the agent. Adapters that can host a tool loop honor it using their native
   * mechanism (MCP server, direct registry call). `runAgentHarness` rejects
   * requests against adapters whose `askOwnerToolName` is `null`.
   */
  askOwner?: AgentAskOwnerOptions;
};

export type AgentHarnessResult = {
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

/**
 * An agent harness is the long-lived loop that turns a prompt plus options
 * into a completed agent run. Different adapters implement this protocol
 * against different runtimes (Claude Agent SDK, thin ModelClient loop, codex
 * agent SDK, etc.). The session/step/delegate layer always calls the protocol
 * and never the underlying runtime directly.
 */
export type AgentHarness = {
  /** Unique harness name, used to resolve adapters at runtime. */
  readonly name: string;
  /** Short human-facing description of what this harness runs. */
  readonly description: string;
  /**
   * Whether this adapter can sustain a multi-turn interactive conversation.
   * The interactive REPL composes a transcript across turns and delivers it
   * through `run()`, so any adapter whose `run()` honors a textual prompt
   * plus prior-turn context can set this to `true`. Adapters that are
   * fundamentally single-shot (e.g. fire-and-forget webhook runners) set
   * this to `false` — the REPL entry point refuses to launch them.
   */
  readonly supportsMultiTurn: boolean;
  /**
   * Harness-boundary lifecycle hook kinds this adapter honors. The neutral
   * entry point (`runAgentHarness`) dispatches every registered hook of a
   * supported kind around this adapter's `run()`. If a module registers a
   * hook whose kind is not in this list, the entry point throws before
   * invoking `run()` — analogous to how `thin-agent-harness` rejects tool
   * options it cannot host.
   */
  readonly supportedHookKinds: readonly HarnessHookKind[];
  /**
   * The runtime tool name the agent will see in its catalog when
   * `AgentHarnessRunOptions.askOwner` is set. `null` means this adapter
   * cannot host the owner-questions surface; `runAgentHarness` rejects any
   * run that asks for it against such an adapter. Callers that construct an
   * agent prompt use this field to reference the correct tool name across
   * harnesses (e.g. `mcp__kota_owner_questions__ask_owner` on claude,
   * `ask_owner` on openai-tools).
   */
  readonly askOwnerToolName: string | null;
  /**
   * Whether this adapter emits `SDKMessage`-shaped frames to an `onMessage`
   * callback. Claude-Agent-SDK sets this to `true`; the openai-tools and
   * thin adapters have no such stream and reject `onMessage` at the
   * boundary. Callers consult this flag to decide whether to subscribe —
   * branching on a declared capability rather than the adapter name.
   */
  readonly emitsAgentMessageStream: boolean;
  run(
    options: AgentHarnessRunOptions,
    writer?: AgentHarnessWriter,
  ): Promise<AgentHarnessResult>;
};
