import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { KotaAgentMessage } from "./agent-message.js";

export type { KotaAgentMessage } from "./agent-message.js";

import type { HarnessHookKind } from "./hooks.js";
import type {
  AgentHarnessReadinessProbe,
  AgentHarnessUnsupportedOption,
} from "./readiness.js";

/**
 * KOTA-native portable system-prompt text every harness-neutral caller
 * delivers. Adapters that wrap prompts in a native envelope (e.g. the
 * claude-agent-sdk `claude_code` preset) do the wrapping inside the adapter;
 * the protocol surface is a plain string.
 */
export type AgentSystemPrompt = string;

/**
 * KOTA's portable agent-effort enum. Adapters map these literals onto their
 * provider's native reasoning/effort wire shape (see
 * `src/modules/model-clients/reasoning.ts`). Five literals, ordered low-to-max.
 */
export type AgentEffort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * KOTA-native classification of a permission decision, surfaced to UIs that
 * record why a tool call was allowed or rejected. Provider-specific
 * decision-classification literals (claude SDK uses `user_…` shapes; other
 * adapters carry their own) translate to and from this enum at the adapter
 * boundary.
 */
export type AgentDecisionAttribution =
  | "operator-allow-once"
  | "operator-allow-always"
  | "operator-deny";

export type AgentPermissionResult =
  | {
      behavior: "allow";
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: unknown[];
      toolUseId?: string;
      decisionAttribution?: AgentDecisionAttribution;
    }
  | {
      behavior: "deny";
      message: string;
      interrupt?: boolean;
      toolUseId?: string;
      decisionAttribution?: AgentDecisionAttribution;
    };

/**
 * Context object the harness hands to a `canUseTool` callback for one tool
 * call. The shape is KOTA-native; adapters that route through a native SDK
 * (e.g. claude-agent-sdk) translate their context into this shape at the
 * boundary.
 */
export type AgentCanUseToolContext = {
  signal: AbortSignal;
  suggestions?: unknown[];
  blockedPath?: string;
  decisionReason?: string;
  title?: string;
  displayName?: string;
  description?: string;
  toolUseId: string;
  agentId?: string;
};

export type AgentCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  context: AgentCanUseToolContext,
) => Promise<AgentPermissionResult>;

/**
 * One MCP server entry the harness should host for the agent. KOTA-owned
 * discriminated union covering the transport variants every harness can
 * reason about (`stdio | sse | http`). Non-claude adapters reject any
 * non-empty `mcpServers` field at their boundary; the claude adapter passes
 * the entries through to the SDK.
 *
 * Harness-specific in-process hosting mechanisms (e.g. the claude-agent-sdk
 * `sdk` variant that carries a live server instance) stay inside the
 * adapter that owns them and never surface here.
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

export type AgentMcpServerConfig =
  | AgentMcpStdioServerConfig
  | AgentMcpSseServerConfig
  | AgentMcpHttpServerConfig;

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

/**
 * Per-step adapter-private fragment validated by `AgentHarness.validateStepOptions`.
 * The neutral protocol carries this as opaque `unknown` — only the resolved
 * adapter knows its real shape. The executor passes the validated value
 * verbatim through `AgentHarnessRunOptions.harnessOverrides`.
 */
export type AgentHarnessStepOverrides = unknown;

/**
 * Neutral, KOTA-native run options every adapter consumes.
 *
 * Every field on this type is either a KOTA concept (autonomy mode, tools,
 * effort, prompt, owner-questions, abort, MCP transport variants) or a
 * harness-agnostic transport knob (cwd, model name, max turns, system
 * prompt). Provider-specific knobs (claude SDK permission/setting fields,
 * future Codex CLI flags, …) must travel inside `harnessOverrides` and be
 * validated by the resolved adapter's `validateStepOptions`.
 */
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
  /**
   * KOTA-native session supervision posture. The adapter maps this onto its
   * provider's native permission knob. Adapters without a permission UX
   * must still honor the mode (passive read-only constraints come from
   * `allowedTools`; supervised mode is rejected by every workflow agent
   * step adapter at the boundary).
   *
   * Callers that do not care about supervision posture omit this field;
   * adapters default to `"autonomous"`. Workflow agent steps always set it
   * explicitly because the workflow validator requires
   * `WorkflowAgentStep.autonomyMode`.
   */
  autonomyMode?: AutonomyMode;
  persistSession?: boolean;
  effort: AgentEffort;
  abortController?: AbortController;
  enableFileCheckpointing?: boolean;
  onMessage?: (message: KotaAgentMessage) => void | Promise<void>;
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
  /**
   * Adapter-private per-step overrides validated by the resolved adapter's
   * `validateStepOptions`. The value is opaque to core; the adapter knows its
   * shape. Core never reads or mutates this field.
   */
  harnessOverrides?: AgentHarnessStepOverrides;
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
   * Whether this adapter emits `KotaAgentMessage` frames to an `onMessage`
   * callback. Adapters that do (claude-agent-sdk, future Codex/Vercel) set
   * this to `true`; adapters without a streaming surface (openai-tools,
   * thin) reject `onMessage` at the boundary. Callers consult this flag to
   * decide whether to subscribe — branching on a declared capability rather
   * than the adapter name.
   */
  readonly emitsAgentMessageStream: boolean;
  /**
   * Local readiness probe for operator-facing preflight surfaces. Adapters
   * own runtime details (native CLI, SDK package), harness-managed local
   * auth checks, and unsupported neutral options; preset consumers add preset
   * id, model tiers, and env-auth state.
   */
  readonly readiness?: AgentHarnessReadinessProbe;
  /**
   * Static declaration of neutral run options this adapter cannot honor.
   * `runAgentHarness` checks these before hooks or adapter spawn so a caller
   * that depends on KOTA guardrails cannot accidentally fall through to a
   * prompt-only native runtime. Readiness reports should expose the same
   * entries for operator-facing preflight output.
   */
  readonly unsupportedRunOptions?: readonly AgentHarnessUnsupportedOption[];
  /**
   * Validates a per-step harness-specific options block and returns the
   * adapter-private fragment to thread through as
   * `AgentHarnessRunOptions.harnessOverrides`. The returned value is also
   * stored on the validated workflow step (under the step's
   * `harnessOptions[harness.name]` slot) for history and recovery.
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
  ) => AgentHarnessStepOverrides;
  /**
   * Optional model-id catalog gate. When declared, the workflow validator
   * calls this with the step's resolved model string and the adapter throws
   * with a field-path message when the id is not one this harness can serve.
   * Adapters that genuinely accept any non-empty string (codex, gemini,
   * thin) leave this unset so the wire layer rejects unknown ids at call
   * time.
   *
   * The validator wraps the throw with step-label context before surfacing a
   * `WorkflowDefinitionError`. Returning normally signals acceptance.
   */
  readonly validateModelId?: (modelId: string) => void;
  run(
    options: AgentHarnessRunOptions,
    writer?: AgentHarnessWriter,
  ): Promise<AgentHarnessResult>;
};
