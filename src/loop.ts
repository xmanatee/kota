import { existsSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import { buildUserProfile, type KotaConfig } from "./config.js";
import { Context } from "./context.js";
import { CostTracker } from "./cost.js";
import { tryEmit } from "./event-bus.js";
import { initChangeTracker } from "./file-changes.js";
import { type GuardrailsConfig, getDefaultConfig as getDefaultGuardrails } from "./guardrails.js";
import { initAuditStore } from "./guardrails-audit.js";
import { buildSessionWarmup } from "./init.js";
import { loadInstructionContext } from "./instruction-files.js";
import { type AgentLoopState, runClose, runInitExtensions, saveToHistoryImpl } from "./loop-init.js";
import { runSend } from "./loop-send.js";
import type { McpManager } from "./mcp/manager.js";
import { getHistory } from "./memory/history.js";
import { AnthropicModelClient, type ModelClient } from "./model/model-client.js";
import type { ModelTiers } from "./model/model-router.js";
import { ModuleLoader } from "./module-loader.js";
import { initModuleLogStore } from "./module-log.js";
import { loadProjectContext } from "./project-context.js";
import { initProviderRegistry, registerDefaultProviders } from "./providers.js";
import { initScheduler } from "./scheduler/scheduler.js";
import { initTaskStore } from "./scheduler/task-store.js";
import { type SessionState, SessionStateMachine } from "./session-state.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { enableGroup } from "./tool-groups.js";
import { setConfigProvider, setModuleInfoProvider } from "./tools/agent-status.js";
import { setDelegateConfig } from "./tools/delegate.js";
import { BufferTransport, CliTransport, type Transport } from "./transport.js";
import { detectVerifyCommands, VerifyTracker } from "./verify-tracker.js";

export type LoopOptions = {
  model?: string;
  editorModel?: string;
  maxTokens?: number;
  verbose?: boolean;
  architectMode?: boolean;
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
};

/**
 * Persistent agent session that maintains context across multiple prompts.
 * Used by both single-shot mode and interactive REPL.
 */
export class AgentSession {
  private client: ModelClient;
  private context: Context;
  private costTracker: CostTracker;
  private model: string;
  private editorModel: string;
  private maxTokens: number;
  private effectiveMaxTokens: number;
  private verbose: boolean;
  private architectMode: boolean;
  private sessionPath?: string;
  private thinkingConfig?: Anthropic.Messages.ThinkingConfigParam;
  private verifyTracker: VerifyTracker;
  private mcpManager: McpManager | null = null;
  private moduleLoader: ModuleLoader;
  private transport: Transport;
  private sigintHandler: () => void;
  private closed = false;
  private initialized = false;
  private initPromise: Promise<void>;
  private projectContext: string;
  private instructionContext: string;
  private conversationId: string | null = null;
  private historyEnabled: boolean;
  private historySource: "user" | "action";
  private sessionId: string;
  private sessionLabel?: string;
  private sessionStartTime = 0;
  private guardrailsConfig: GuardrailsConfig;
  private reflectionEnabled: boolean;
  private modelTiers?: ModelTiers;
  private stateMachine: SessionStateMachine;

  constructor(options: LoopOptions = {}) {
    this.sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.sessionLabel = options.label;
    this.model = options.model || "claude-sonnet-4-6";
    this.editorModel = options.editorModel || this.model;
    this.maxTokens = options.maxTokens || 8192;
    this.verbose = options.verbose || false;
    this.architectMode = options.architectMode || false;
    this.sessionPath = options.sessionPath;
    this.transport = options.transport || new CliTransport(this.verbose);
    const isNonInteractive = options.historySource === "action";
    this.guardrailsConfig = options.config?.guardrails
      ?? (isNonInteractive ? { policies: { safe: "allow", moderate: "allow", dangerous: "deny" } } : getDefaultGuardrails());
    this.reflectionEnabled = options.reflectionEnabled ?? options.config?.reflection ?? true;
    this.modelTiers = options.config?.modelTiers;

    const thinkingBudget = options.thinkingBudget || 10_000;
    this.thinkingConfig = options.thinkingEnabled
      ? { type: "enabled", budget_tokens: thinkingBudget }
      : undefined;
    this.effectiveMaxTokens = options.thinkingEnabled
      ? thinkingBudget + this.maxTokens
      : this.maxTokens;

    this.client = options.client ?? new AnthropicModelClient({ maxRetries: 5 });
    this.costTracker = new CostTracker();

    initTaskStore(process.cwd());
    initScheduler(process.cwd());
    initModuleLogStore(process.cwd());
    initAuditStore(process.cwd());
    initChangeTracker();
    initProviderRegistry();
    registerDefaultProviders();

    this.projectContext = loadProjectContext();
    const projectContext = this.projectContext;
    const instructionContext = loadInstructionContext();
    this.instructionContext = instructionContext;
    const warmup = buildSessionWarmup();
    const userProfile = options.config ? buildUserProfile(options.config) : "";
    const systemPrompt = SYSTEM_PROMPT + projectContext + instructionContext + userProfile + warmup;
    if (projectContext && this.verbose) {
      this.transport.emit({ type: "status", message: "[kota] Loaded project context from .kota.md" });
    }
    if (instructionContext && this.verbose) {
      this.transport.emit({ type: "status", message: "[kota] Loaded project instructions from AGENTS.md / CLAUDE.md" });
    }
    if (userProfile && this.verbose) {
      this.transport.emit({ type: "status", message: "[kota] User profile loaded from config" });
    }
    if (warmup && this.verbose) {
      this.transport.emit({ type: "status", message: "[kota] Session warmup loaded" });
    }

    if (options.config?.autoEnable) {
      for (const group of options.config.autoEnable) {
        enableGroup(group);
      }
      if (this.verbose) {
        this.transport.emit({
          type: "status",
          message: `[kota] Auto-enabled tool groups: ${options.config.autoEnable.join(", ")}`,
        });
      }
    }

    if (options.resumeConversation) {
      const history = getHistory();
      const data = history.load(options.resumeConversation);
      if (data) {
        this.conversationId = options.resumeConversation;
        this.context = new Context(systemPrompt);
        this.context.restoreFrom(data.messages, data.compactionCount, data.lastInputTokens);
        this.transport.emit({
          type: "status",
          message: `[kota] Resumed conversation: "${data.record.title}" (${data.record.messageCount} messages)`,
        });
      } else {
        this.context = new Context(systemPrompt);
        this.transport.emit({ type: "error", message: `[kota] Conversation ${options.resumeConversation} not found, starting fresh` });
      }
    } else if (this.sessionPath && existsSync(this.sessionPath)) {
      this.context = Context.load(this.sessionPath, systemPrompt);
      if (this.verbose) this.transport.emit({ type: "status", message: `[kota] Resumed session from ${this.sessionPath}` });
    } else {
      this.context = new Context(systemPrompt);
    }

    this.historyEnabled = !options.noHistory && (!this.sessionPath || !!this.conversationId);
    this.historySource = options.historySource ?? "user";

    this.verifyTracker = new VerifyTracker(detectVerifyCommands());

    setDelegateConfig({
      model: this.editorModel,
      modelTiers: options.config?.modelTiers,
      client: this.client,
      cwd: process.cwd(),
      projectContext: projectContext || undefined,
      instructionContext: instructionContext || undefined,
      costTracker: this.costTracker,
      transport: this.transport,
    });

    this.moduleLoader = new ModuleLoader(options.config || {}, this.verbose);
    setModuleInfoProvider(() =>
      this.moduleLoader.getLoadedModules().map((name) => ({
        name,
        toolCount: 0,
      })),
    );
    if (options.config) {
      const cfg = options.config;
      setConfigProvider(() => {
        const { modelProvider, ...safe } = cfg;
        return {
          ...safe,
          modelProvider: modelProvider
            ? { type: modelProvider.type, baseUrl: modelProvider.baseUrl }
            : undefined,
        };
      });
    }
    this.moduleLoader.setSessionFactory((opts) => {
      const session = new AgentSession({
        model: opts.model || this.model,
        config: options.config,
        transport: new BufferTransport(),
        label: opts.label,
        noHistory: opts.noHistory ?? true,
        historySource: "action",
        reflectionEnabled: false,
      });
      return {
        send: (prompt: string) => session.send(prompt),
        close: () => session.close(),
      };
    });

    this.stateMachine = new SessionStateMachine();
    this.stateMachine.onChange((from, to, meta) => {
      this.transport.emit({ type: "state_change", from, to, meta });
      tryEmit("session.state", { sessionId: this.sessionId, from, to, meta });
    });
    this.stateMachine.transition("initializing");
    this.initPromise = this.initExtensions();

    this.sigintHandler = () => {
      if (this.sessionPath) {
        this.context.save(this.sessionPath);
        this.transport.emit({ type: "status", message: `\n[kota] Session saved to ${this.sessionPath}` });
      }
      this.saveToHistory();
      process.exit(0);
    };
    process.on("SIGINT", this.sigintHandler);
  }

  private async initExtensions(): Promise<void> {
    return runInitExtensions(this as unknown as AgentLoopState);
  }

  /** Send a prompt and run the agent loop until the agent stops. */
  async send(prompt: string): Promise<string> {
    return runSend(this as unknown as AgentLoopState, prompt);
  }

  /** Save current state to conversation history. Creates the entry lazily on first call with messages. */
  private saveToHistory(): void {
    saveToHistoryImpl(this as unknown as AgentLoopState);
  }

  getCostSummary(): string { return this.costTracker.getSummary(); }

  getState(): SessionState { return this.stateMachine.current(); }

  getConversationId(): string | null { return this.conversationId; }

  /** Clean up handlers and save final state. */
  close(errored = false): void {
    process.removeListener("SIGINT", this.sigintHandler);
    runClose(this as unknown as AgentLoopState, errored);
  }
}

/** Convenience wrapper: create a session, send one prompt, close. */
export async function runAgentLoop(
  prompt: string,
  options: LoopOptions = {},
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
