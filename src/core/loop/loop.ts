import type { KotaThinkingConfig } from "#core/agent-harness/message-protocol.js";
import type { ChannelUserIdentity } from "#core/channels/channel.js";
import type { KotaConfig } from "#core/config/config.js";
import type { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import type { ProjectRuntime } from "#core/daemon/project-runtime.js";
import { tryEmit } from "#core/events/event-bus.js";
import type { McpAuthorizationResolver } from "#core/mcp/client.js";
import type { McpInputResolver, McpManager, McpServerConfig } from "#core/mcp/manager.js";
import type { ModelClient } from "#core/model/model-client.js";
import type { ModelTiers } from "#core/model/model-router.js";
import type { ModelOutputTokenLimits } from "#core/model/output-token-limits.js";
import type { ModuleLoader } from "#core/modules/module-loader.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import {
  cloneGuardrailsConfig,
  createGuardrailsSnapshot,
  fingerprintGuardrailsConfig,
  type GuardrailsConfig,
  type GuardrailsSnapshot,
} from "#core/tools/guardrails.js";
import type { ToolApprovalResolver } from "#core/tools/tool-runner.js";
import type { Context } from "./context.js";
import type { CostTracker } from "./cost.js";
import { initAgentSession } from "./loop-constructor.js";
import { type AgentLoopState, runClose, saveToHistoryImpl } from "./loop-init.js";
import { runSend } from "./loop-send.js";
import type { SessionState, SessionStateMachine } from "./session-state.js";
import { BufferTransport, type ProxyTransport, type Transport } from "./transport.js";
import type { VerifyTracker } from "./verify-tracker.js";

export type LoopOptions = {
  /**
   * Operator supervision mode for this session. Required — sessions must be
   * created with an explicit autonomy mode. See {@link AutonomyMode}.
   */
  autonomyMode: AutonomyMode;
  model?: string;
  editorModel?: string;
  maxTokens?: number;
  verbose?: boolean;
  sessionPath?: string;
  thinkingEnabled?: boolean;
  thinkingBudget?: number;
  transport?: Transport;
  config?: KotaConfig;
  /** Resume a specific conversation by ID. */
  resumeConversation?: string;
  /** Disable automatic conversation history tracking. */
  noHistory?: boolean;
  /** Tag conversations as "action" (autonomous) vs "user" (interactive). Affects history pruning. */
  historySource?: "user" | "action";
  /** Optional label for event bus (e.g. "build-agent", "user-repl"). */
  label?: string;
  /** Enable self-reflection before delivering final response. Default: true. */
  reflectionEnabled?: boolean;
  /** Inject a model client (for testing with mock clients or alternative providers). */
  client?: ModelClient;
  /** Show per-turn cost line in terminal output (default: true). */
  showCost?: boolean;
  /** Channel user identity for attribution (set by channel adapters). */
  channelIdentity?: ChannelUserIdentity;
  /** Project root this session should initialize against. Defaults to process.cwd(). */
  projectDir?: string;
  /**
   * Existing daemon-owned project runtime bundle to bind this session to.
   * When supplied, the session reuses the bundle's stores instead of
   * constructing new singleton-backed stores from `projectDir`.
   */
  projectRuntime?: ProjectRuntime;
  /** Optional existing operator surface bridge for remote MCP input_required retries. */
  mcpInputResolver?: McpInputResolver;
  mcpAuthorizationResolver?: McpAuthorizationResolver;
  /** Per-session MCP servers supplied by an external client after boundary normalization. */
  mcpServers?: Record<string, McpServerConfig>;
  /** Optional live-client resolver for queued tool approvals during a turn. */
  clientApprovalResolver?: ToolApprovalResolver;
};

export type GuardrailsConfigReplacement = {
  changed: boolean;
  snapshot: GuardrailsSnapshot;
};

/**
 * Persistent agent session that maintains context across multiple prompts.
 * Used by both single-shot mode and interactive REPL.
 */
export class AgentSession implements AgentLoopState {
  client!: ModelClient;
  context!: Context;
  costTracker!: CostTracker;
  model!: string;
  editorModel!: string;
  maxTokens!: number;
  effectiveMaxTokens!: number;
  verbose!: boolean;
  sessionPath: string | undefined;
  thinkingConfig: KotaThinkingConfig | undefined;
  verifyTracker!: VerifyTracker;
  mcpManager: McpManager | null = null;
  mcpInputResolver: McpInputResolver | undefined;
  mcpAuthorizationResolver: McpAuthorizationResolver | undefined;
  mcpServers: Record<string, McpServerConfig> | undefined;
  clientApprovalResolver: ToolApprovalResolver | undefined;
  moduleLoader!: ModuleLoader;
  transport!: Transport;
  defaultTransportProxy: ProxyTransport | undefined;
  showCost!: boolean;
  sigintHandler!: () => void;
  closed = false;
  activeAbortControllers = new Set<AbortController>();
  initialized = false;
  initPromise!: Promise<void>;
  projectDir!: string;
  projectContext!: string;
  instructionContext!: string;
  conversationId: string | null = null;
  resumeConversationId: string | undefined;
  historyEnabled!: boolean;
  historySource!: "user" | "action";
  sessionId!: string;
  sessionLabel: string | undefined;
  sessionStartTime = 0;
  guardrailsConfig!: GuardrailsConfig;
  reflectionEnabled!: boolean;
  idempotencyStore!: IdempotencyStore;
  modelTiers: ModelTiers | undefined;
  modelOutputTokenLimits: ModelOutputTokenLimits | undefined;
  stateMachine!: SessionStateMachine;
  channelIdentity: ChannelUserIdentity | undefined;
  autonomyMode!: AutonomyMode;
  guardrailsSnapshot!: GuardrailsSnapshot;

  constructor(options: LoopOptions) {
    initAgentSession(this, options, (opts) => {
      const config: KotaConfig = options.config
        ? { ...options.config, guardrails: this.guardrailsConfig }
        : { guardrails: this.guardrailsConfig };
      const session = new AgentSession({
        autonomyMode: this.autonomyMode,
        model: opts.model || this.model,
        config,
        transport: new BufferTransport(),
        label: opts.label,
        noHistory: opts.noHistory ?? true,
        historySource: "action",
        reflectionEnabled: false,
        projectDir: this.projectDir,
        projectRuntime: options.projectRuntime,
        mcpInputResolver: this.mcpInputResolver,
        mcpAuthorizationResolver: this.mcpAuthorizationResolver,
      });
      return {
        send: (prompt: string) => session.send(prompt),
        close: () => session.close(),
      };
    });
  }

  /** Send a prompt and run the agent loop until the agent stops. */
  async send(prompt: string): Promise<string> {
    return runSend(this, prompt);
  }

  /** Save current state to conversation history. Creates the entry lazily on first call with messages. */
  private saveToHistory(): void {
    saveToHistoryImpl(this);
  }

  getCostSummary(): string { return this.costTracker.getSummary(); }

  getState(): SessionState { return this.stateMachine.current(); }

  getConversationId(): string | null { return this.conversationId; }

  getChannelIdentity(): ChannelUserIdentity | undefined { return this.channelIdentity; }

  getAutonomyMode(): AutonomyMode { return this.autonomyMode; }

  getGuardrailsSnapshot(): GuardrailsSnapshot {
    return { ...this.guardrailsSnapshot };
  }

  replaceGuardrailsConfig(config: GuardrailsConfig): GuardrailsConfigReplacement {
    const nextConfig = cloneGuardrailsConfig(config);
    const nextId = fingerprintGuardrailsConfig(nextConfig);
    if (nextId === this.guardrailsSnapshot.id) {
      return { changed: false, snapshot: this.getGuardrailsSnapshot() };
    }
    this.guardrailsConfig = nextConfig;
    this.guardrailsSnapshot = createGuardrailsSnapshot(
      nextConfig,
      this.guardrailsSnapshot.generation + 1,
    );
    return { changed: true, snapshot: this.getGuardrailsSnapshot() };
  }

  /**
   * Change the session's autonomy mode mid-flight. Operators invoke this
   * through the daemon control API or a channel-specific command; the new
   * mode applies to the next tool call and onwards. Emits
   * `session.autonomy.changed` only when the mode actually changes so
   * subscribers can count distinct transitions.
   */
  setAutonomyMode(mode: AutonomyMode): void {
    const from = this.autonomyMode;
    if (from === mode) return;
    this.autonomyMode = mode;
    tryEmit("session.autonomy.changed", { sessionId: this.sessionId, from, to: mode });
  }

  setClientApprovalResolver(resolver: ToolApprovalResolver | undefined): void {
    this.clientApprovalResolver = resolver;
  }

  /** Abort the active turn without closing the session. */
  cancelActiveTurn(reason: Error = new Error("Session cancelled")): void {
    for (const controller of this.activeAbortControllers) {
      if (!controller.signal.aborted) controller.abort(reason);
    }
  }

  /** Clean up handlers and save final state. */
  close(errored = false): void {
    process.removeListener("SIGINT", this.sigintHandler);
    runClose(this, errored);
  }
}

/** Convenience wrapper: create a session, send one prompt, close. */
export async function runAgentLoop(
  prompt: string,
  options: LoopOptions,
): Promise<string> {
  const session = new AgentSession(options);
  let errored = false;
  try {
    return await session.send(prompt);
  } catch (err) {
    errored = true;
    throw err;
  } finally {
    session.close(errored);
  }
}
