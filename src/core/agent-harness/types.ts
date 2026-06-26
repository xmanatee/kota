import type { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import type { ModelProviderSelection } from "#core/model/model-client.js";
import type { ModelOutputTokenLimits } from "#core/model/output-token-limits.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { GuardrailsConfig } from "#core/tools/guardrails.js";
import type { ToolApprovalResolver } from "#core/tools/tool-approval.js";
import type { KotaAgentMessage } from "./agent-message.js";
import type {
  AgentAskOwnerOptions,
  AgentCanUseTool,
  AgentMcpServers,
} from "./run-option-types.js";
import type { AgentTokenBudgetLedger } from "./token-budget.js";

export type { KotaAgentMessage } from "./agent-message.js";
export type {
  AgentAskOwnerOptions,
  AgentCanUseTool,
  AgentCanUseToolContext,
  AgentDecisionAttribution,
  AgentMcpHttpServerConfig,
  AgentMcpServerConfig,
  AgentMcpServers,
  AgentMcpSseServerConfig,
  AgentMcpStdioServerConfig,
  AgentPermissionResult,
} from "./run-option-types.js";

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

export type AgentHarnessWriter = { write(text: string): boolean };

export type AgentHarnessWorkflowContext = {
  workflowName: string;
  runId: string;
  stepId: string;
  spanId: string;
  scopeId: string;
  projectId: string;
};

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
  /**
   * Shared ModelClient provider selection for adapters that execute through
   * `createModelClient`. This is KOTA's own model routing surface, not a
   * provider-native wire shape; adapters that use native CLIs ignore it.
   */
  modelProvider?: ModelProviderSelection;
  /**
   * Operator-provided output-token request budgets keyed by model id. Shipped
   * preset model ids resolve through core; this map covers custom ids or
   * intentional overrides for KOTA-native ModelClient harnesses.
   */
  modelOutputTokenLimits?: ModelOutputTokenLimits;
  cwd?: string;
  verbose?: boolean;
  systemPrompt?: AgentSystemPrompt;
  maxTurns?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: AgentMcpServers;
  /**
   * KOTA-native session supervision posture. The adapter maps this onto its
   * provider's native permission or KOTA-owned tool-runner gate. Adapters
   * without a permission UX must still honor the mode or reject it loudly
   * through their unsupported-option boundary.
   *
   * Callers that do not care about supervision posture omit this field;
   * adapters default to `"autonomous"`. Workflow agent steps always set it
   * explicitly because the workflow validator requires
   * `WorkflowAgentStep.autonomyMode`.
   */
  autonomyMode?: AutonomyMode;
  persistSession?: boolean;
  resumeSessionId?: string;
  workflowContext?: AgentHarnessWorkflowContext;
  /**
   * Shared per-run token budget ledger. KOTA-controlled loops must check this
   * before each model turn and debit usage after the provider returns it.
   * Native adapters that only expose aggregate usage debit at the wrapper
   * boundary and record a non-enforcing diagnostic.
   */
  tokenBudget?: AgentTokenBudgetLedger;
  effort: AgentEffort;
  abortController?: AbortController;
  enableFileCheckpointing?: boolean;
  onMessage?: (message: KotaAgentMessage) => void | Promise<void>;
  thinkingEnabled?: boolean;
  thinkingBudget?: number;
  canUseTool?: AgentCanUseTool;
  /**
   * KOTA-owned tool-runner context for adapters that execute tools in-process.
   * Native CLI adapters do not consume these fields because they do not host the
   * shared KOTA tool runner.
   */
  guardrailsConfig?: GuardrailsConfig;
  clientApprovalResolver?: ToolApprovalResolver;
  idempotencyStore?: IdempotencyStore;
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
   * Which runtime owns tool access for this harness. `kota` means callers can
   * route neutral tool-control options (`allowedTools`, `disallowedTools`,
   * `canUseTool`) through the adapter. `native` means the adapter's own CLI
   * process owns the tool loop and rejects KOTA-only controls.
   */
  readonly toolControl: "kota" | "native";
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
