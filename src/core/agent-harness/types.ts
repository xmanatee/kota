import type { HarnessHookKind } from "./hooks.js";
import type {
  SDKMessage,
  SDKPermissionMode,
  SDKSettingSource,
} from "./sdk-types.js";

/**
 * Harness-neutral re-exports. Message, permission, and settings shapes live in
 * `./sdk-types.ts` because they originated with the Claude Agent SDK, but the
 * protocol treats them as neutral wire types every harness adapter must read
 * or produce. Non-claude adapters convert between their native payloads and
 * these shapes at the boundary.
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

/**
 * KOTA's portable agent-effort enum. Adapters map these literals onto their
 * provider's native reasoning/effort wire shape (see
 * `src/modules/model-clients/reasoning.ts`). Five literals, ordered low-to-max.
 */
export type AgentEffort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Harness-neutral classification of a permission decision, surfaced to UIs
 * that record why a tool call was allowed or rejected. Mirrors the
 * claude-agent-sdk's `PermissionDecisionClassification` literals so adapters
 * can pass values through without translation.
 */
export type AgentPermissionDecisionClassification =
  | "user_temporary"
  | "user_permanent"
  | "user_reject";

export type AgentPermissionResult =
  | {
      behavior: "allow";
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: unknown[];
      toolUseID?: string;
      decisionClassification?: AgentPermissionDecisionClassification;
    }
  | {
      behavior: "deny";
      message: string;
      interrupt?: boolean;
      toolUseID?: string;
      decisionClassification?: AgentPermissionDecisionClassification;
    };

/**
 * Context object the harness hands to a `canUseTool` callback for one tool
 * call. Adapters that route through the claude-agent-sdk hand the SDK's
 * native context object straight through; structurally compatible with this
 * neutral shape.
 */
export type AgentCanUseToolContext = {
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

export type AgentCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  context: AgentCanUseToolContext,
) => Promise<AgentPermissionResult>;

/**
 * One MCP server entry the harness should host for the agent. KOTA-owned
 * discriminated union covering the variants the claude-agent-sdk actually
 * accepts today (`stdio | sse | http | sdk`). Non-claude adapters reject any
 * non-empty `mcpServers` field at their boundary; the claude adapter passes
 * the entries through to the SDK with a typed cast.
 *
 * The `sdk` variant carries an in-process MCP server `instance` typed as
 * `unknown` because the underlying server class is a claude-agent-sdk
 * internal — only the claude adapter constructs values of this shape via
 * `createSdkMcpServer`, and only the SDK consumes them.
 */
export type AgentMcpStdioServerConfig = {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type AgentMcpSseServerConfig = {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
  tools?: unknown[];
};

export type AgentMcpHttpServerConfig = {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  tools?: unknown[];
};

export type AgentMcpSdkServerConfig = {
  type: "sdk";
  name: string;
  instance: unknown;
};

export type AgentMcpServerConfig =
  | AgentMcpStdioServerConfig
  | AgentMcpSseServerConfig
  | AgentMcpHttpServerConfig
  | AgentMcpSdkServerConfig;

export type AgentMcpServers = Record<string, AgentMcpServerConfig>;

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
  /**
   * Validates a per-step harness-specific options block and returns the
   * neutral `AgentHarnessRunOptions` fragment to merge into the adapter run
   * when the step executes. The returned object is also stored on the
   * validated workflow step (under the step's `harnessOptions[harness.name]`
   * slot) for history and recovery.
   *
   * Declared only on harnesses that accept per-step options. Throws on
   * malformed input with a field-path message; the core step validator
   * catches the throw and wraps it with step-label context before surfacing
   * the `WorkflowDefinitionError`. Returning `undefined` is the supported
   * "no per-step overrides" signal — e.g. the caller supplied `{}` and the
   * harness treats empty as no-op.
   *
   * Only fields that are safe to serialize and safe to re-apply on a replay
   * should appear in the returned fragment; runtime-only fields such as
   * `abortController` or `canUseTool` must not be produced here.
   */
  readonly validateStepOptions?: (
    raw: unknown,
  ) => Partial<AgentHarnessRunOptions> | undefined;
  run(
    options: AgentHarnessRunOptions,
    writer?: AgentHarnessWriter,
  ): Promise<AgentHarnessResult>;
};
