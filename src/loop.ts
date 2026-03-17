import { existsSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { runArchitectStep } from "./architect-runner.js";
import { buildUserProfile, type KotaConfig } from "./config.js";
import { CONTEXT_WINDOW, Context } from "./context.js";
import { CostTracker } from "./cost.js";
import { getEventBus, tryEmit } from "./event-bus.js";
import { getChangeTracker, initChangeTracker, resetChangeTracker } from "./file-changes.js";
import { type GuardrailsConfig, getDefaultConfig as getDefaultGuardrails } from "./guardrails.js";
import { getHistory } from "./history.js";
import { buildSessionWarmup } from "./init.js";
import { McpManager } from "./mcp-manager.js";
import { listManifestModules } from "./module-factory.js";
import { ModuleLoader } from "./module-loader.js";
import { builtinModules } from "./modules/index.js";
import { discoverPluginModules } from "./plugin-loader.js";
import { loadProjectContext } from "./project-context.js";
import { buildReflectionPrompt, getLastAssistantText, shouldReflect } from "./reflection.js";
import { analyzeRequest, formatContextHint } from "./request-analyzer.js";
import { initScheduler } from "./scheduler.js";
import { streamMessage } from "./streaming.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { formatTaskHint, routeTask } from "./task-router.js";
import { initTaskStore } from "./task-store.js";
import { detectToolGroups, enableGroup, filterTools, resetGroups } from "./tool-groups.js";
import { executeToolCalls, FailureTracker } from "./tool-runner.js";
import { cleanupSessions } from "./tools/code-exec.js";
import { loadSavedTools, resetCustomTools } from "./tools/custom-tool.js";
import { setDelegateConfig } from "./tools/delegate.js";
import { getAllTools } from "./tools/index.js";
import { markModuleLoaded, resetModuleFactory } from "./tools/module-factory.js";
import { cleanupProcesses } from "./tools/process.js";
import { CliTransport, type Transport } from "./transport.js";
import { detectVerifyCommands, processToolResults, VerifyTracker } from "./verify-tracker.js";


const MAX_ITERATIONS = 200;

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
  /** Inject an Anthropic client (for testing with mock clients). */
  client?: Anthropic;
};

/**
 * Persistent agent session that maintains context across multiple prompts.
 * Used by both single-shot mode and interactive REPL.
 */
export class AgentSession {
  private client: Anthropic;
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
  private conversationId: string | null = null;
  private historyEnabled: boolean;
  private historySource: "user" | "action";
  private sessionId: string;
  private sessionLabel?: string;
  private sessionStartTime = 0;
  private guardrailsConfig: GuardrailsConfig;
  private reflectionEnabled: boolean;

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
    // Non-interactive sessions (actions, server-spawned) use stricter guardrails by default
    const isNonInteractive = options.historySource === "action";
    this.guardrailsConfig = options.config?.guardrails
      ?? (isNonInteractive ? { policies: { safe: "allow", moderate: "allow", dangerous: "deny" } } : getDefaultGuardrails());
    this.reflectionEnabled = options.reflectionEnabled ?? options.config?.reflection ?? true;

    const thinkingBudget = options.thinkingBudget || 10_000;
    this.thinkingConfig = options.thinkingEnabled
      ? { type: "enabled", budget_tokens: thinkingBudget }
      : undefined;
    this.effectiveMaxTokens = options.thinkingEnabled
      ? thinkingBudget + this.maxTokens
      : this.maxTokens;

    this.client = options.client ?? new Anthropic({ maxRetries: 5 });
    this.costTracker = new CostTracker();

    // Initialize persistent stores for this project
    initTaskStore(process.cwd());
    initScheduler(process.cwd());
    initChangeTracker();

    this.projectContext = loadProjectContext();
    const projectContext = this.projectContext;
    const warmup = buildSessionWarmup();
    const userProfile = options.config ? buildUserProfile(options.config) : "";
    const systemPrompt = SYSTEM_PROMPT + projectContext + userProfile + warmup;
    if (projectContext && this.verbose) {
      this.transport.emit({ type: "status", message: "[kota] Loaded project context from .kota.md" });
    }
    if (userProfile && this.verbose) {
      this.transport.emit({ type: "status", message: "[kota] User profile loaded from config" });
    }
    if (warmup && this.verbose) {
      this.transport.emit({ type: "status", message: "[kota] Session warmup loaded" });
    }

    // Auto-enable tool groups from config
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

    // Resume from conversation history, legacy session file, or start fresh
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

    // History is enabled if not explicitly disabled. When resuming a conversation,
    // always keep saving to it even if sessionPath is also set.
    this.historyEnabled = !options.noHistory && (!this.sessionPath || !!this.conversationId);
    this.historySource = options.historySource ?? "user";

    this.verifyTracker = new VerifyTracker(detectVerifyCommands());

    setDelegateConfig({
      model: this.editorModel,
      client: this.client,
      cwd: process.cwd(),
      projectContext: projectContext || undefined,
      costTracker: this.costTracker,
      transport: this.transport,
    });

    this.moduleLoader = new ModuleLoader(options.config || {}, this.verbose);

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
    const config = McpManager.loadConfig();
    if (config) {
      this.mcpManager = new McpManager();
      await this.mcpManager.initialize(config);
      if (this.mcpManager.getToolCount() > 0) {
        // Update delegate config so sub-agents can use MCP tools
        setDelegateConfig({
          model: this.editorModel,
          client: this.client,
          cwd: process.cwd(),
          projectContext: this.projectContext || undefined,
          costTracker: this.costTracker,
          transport: this.transport,
          mcpManager: this.mcpManager,
        });
        if (this.verbose) {
          this.transport.emit({
            type: "status",
            message: `[kota] MCP: ${this.mcpManager.getServerCount()} server(s), ${this.mcpManager.getToolCount()} tool(s)`,
          });
        }
      }
    }

    const pluginModules = await discoverPluginModules(undefined, this.verbose);
    // Track which manifest modules were discovered for module_factory status
    for (const { name } of listManifestModules()) markModuleLoaded(name);
    await this.moduleLoader.loadAll([...builtinModules, ...pluginModules]);

    // Append module prompt sections to system prompt
    const modulePromptSections = this.moduleLoader.getPromptSections();
    if (modulePromptSections) {
      this.context.appendSystemPrompt(modulePromptSections);
    }

    // Load persisted custom tools from .kota/tools/
    const customToolCount = loadSavedTools();
    if (customToolCount > 0 && this.verbose) {
      this.transport.emit({ type: "status", message: `[kota] Loaded ${customToolCount} custom tool(s)` });
    }

    // Connect module event subscriptions to the bus if it exists
    // (server and daemon init the bus before creating sessions)
    const bus = getEventBus();
    if (bus) this.moduleLoader.connectEvents(bus);

    this.initialized = true;
  }

  /** Send a prompt and run the agent loop until the agent stops. */
  async send(prompt: string): Promise<string> {
    if (!this.initialized) await this.initPromise;
    if (this.sessionStartTime === 0) {
      this.sessionStartTime = Date.now();
      tryEmit("session.start", { sessionId: this.sessionId, label: this.sessionLabel });
    }

    // Request-aware context pre-loading and task routing.
    // Zero LLM cost — pure heuristics and pattern matching.
    const analysis = analyzeRequest(prompt, process.cwd());
    const taskRoute = routeTask(prompt);
    let augmentedPrompt = prompt;
    if (analysis) augmentedPrompt += formatContextHint(analysis);
    augmentedPrompt += formatTaskHint(taskRoute);

    this.context.addUserMessage(augmentedPrompt);
    for (const g of detectToolGroups(prompt)) enableGroup(g);
    if (taskRoute) {
      for (const g of taskRoute.groups) enableGroup(g);
    }
    let lastResult = "";

    // MCP tools always included; built-in tools filtered by active groups
    const mcpTools = this.mcpManager ? this.mcpManager.getTools() : [];

    if (this.architectMode) {
      const result = await runArchitectStep({
        client: this.client,
        model: this.model,
        editorModel: this.editorModel,
        maxTokens: this.maxTokens,
        effectiveMaxTokens: this.effectiveMaxTokens,
        systemContext: this.context.getSystemPrompt(),
        messages: this.context.getMessages(),
        costTracker: this.costTracker,
        verbose: this.verbose,
        thinkingConfig: this.thinkingConfig,
        transport: this.transport,
      });
      if (result) {
        lastResult = result.lastResult;
        for (const f of result.modifiedFiles) this.verifyTracker.recordEdit(f);
        this.context.addAssistantText(result.summary);
        this.context.addUserMessage(
          "The architect/editor has made changes. " +
          "Verify they are correct: run builds, tests, or type checks as appropriate.",
        );
      }
    }

    const failureTracker = new FailureTracker();
    let reflectionDone = false;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      // Always-on observation masking: replace old tool outputs with placeholders.
      // Zero-cost (no LLM call), runs every turn to keep context lean.
      const maskStats = this.context.maskOldObservations();
      if (maskStats.maskedCount > 0) {
        this.transport.emit({
          type: "status",
          message: `[kota] Masked ${maskStats.maskedCount} old observations (saved ~${Math.round(maskStats.charsSaved / 4)} tokens)`,
        });
      }

      if (this.context.needsCompaction()) {
        if (this.verbose) this.transport.emit({ type: "status", message: "[kota] Compacting context..." });
        await this.context.compact(this.client, this.model);
      }

      if (this.verbose) {
        const stats = this.context.getStats();
        this.transport.emit({
          type: "status",
          message: `[kota] Turn ${i + 1} (${stats.turns} messages, ${stats.compactions} compactions)`,
        });
      }

      // Build system blocks: static prompt (cached) + dynamic state (uncached)
      const system: Anthropic.Messages.TextBlockParam[] = [
        { type: "text", text: this.context.getStaticPrompt(), cache_control: { type: "ephemeral" } },
      ];
      const changesSummary = getChangeTracker()?.getSummary() ?? "";
      const dynamicState = this.context.getDynamicState() + this.verifyTracker.getState() + changesSummary;
      if (dynamicState) {
        system.push({ type: "text", text: dynamicState });
      }

      // Progressive disclosure: filter built-in tools by active groups, include MCP tools
      const activeTools = [...filterTools(getAllTools()), ...mcpTools];

      const { response, streamedText } = await streamMessage({
        client: this.client,
        model: this.model,
        maxTokens: this.effectiveMaxTokens,
        system,
        messages: this.context.getMessages(),
        tools: activeTools,
        thinkingConfig: this.thinkingConfig,
        transport: this.transport,
      });

      if (streamedText) {
        this.transport.emit({ type: "text", content: "\n" });
        lastResult = streamedText;
      }

      this.context.setInputTokens(response.usage.input_tokens);
      this.costTracker.addUsage(this.model, response.usage);
      const budgetPct = Math.round(this.context.getBudgetPercent() * 100);
      this.transport.emit({
        type: "cost",
        summary: `Turn ${i + 1} — ${this.costTracker.getSummary()}`,
        budgetPercent: budgetPct,
      });

      if (this.verbose) {
        const u = response.usage;
        this.transport.emit({
          type: "status",
          message: `[kota] Tokens: input=${u.input_tokens}/${CONTEXT_WINDOW}` +
            (u.cache_read_input_tokens ? `, cache_read=${u.cache_read_input_tokens}` : "") +
            (u.cache_creation_input_tokens ? `, cache_created=${u.cache_creation_input_tokens}` : ""),
        });
      }

      this.context.addAssistantMessage(response);

      const toolBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
      );

      if (toolBlocks.length === 0) {
        // Self-reflection: before delivering, evaluate response quality
        if (this.reflectionEnabled && !reflectionDone) {
          const responseText = streamedText || getLastAssistantText(this.context.getMessages());
          if (shouldReflect(this.context.getMessages(), responseText)) {
            reflectionDone = true;
            const reflectionPrompt = buildReflectionPrompt(this.context.getMessages());
            this.context.addUserMessage(reflectionPrompt);
            this.transport.emit({ type: "status", message: "[kota] Self-reflecting on response quality..." });
            continue;
          }
        }
        break;
      }

      const resultLimit = this.context.getToolResultLimit();
      const validResults = await executeToolCalls(
        toolBlocks, resultLimit, this.verbose, this.mcpManager ?? undefined, this.transport,
        this.guardrailsConfig,
      );
      this.context.addToolResults(validResults);

      processToolResults(this.verifyTracker, toolBlocks, validResults);

      if (this.sessionPath) this.context.save(this.sessionPath);
      this.saveToHistory();

      const action = failureTracker.record(validResults);
      if (action !== "continue") {
        const msg = FailureTracker.getMessage(action);
        this.transport.emit({
          type: "error",
          message: `[kota] ${action === "circuit_break" ? "Circuit breaker" : "Failure guidance"}: ${msg}`,
        });
        this.context.addUserMessage(msg);
      }
    }

    if (this.sessionPath) this.context.save(this.sessionPath);
    this.saveToHistory();
    return lastResult;
  }

  /** Save current state to conversation history. Creates the entry lazily on first call with messages. */
  private saveToHistory(): void {
    if (!this.historyEnabled) return;
    const snapshot = this.context.snapshot();
    const history = getHistory();
    if (!this.conversationId) {
      if (snapshot.messages.length === 0) return;
      this.conversationId = history.create(this.model, process.cwd(), this.historySource);
    }
    history.save(this.conversationId, snapshot.messages, snapshot.compactionCount, snapshot.lastInputTokens);
  }

  /** Get cumulative cost summary string. */
  getCostSummary(): string {
    return this.costTracker.getSummary();
  }

  /** Get the conversation ID for this session (null if history tracking disabled). */
  getConversationId(): string | null {
    return this.conversationId;
  }

  /** Clean up handlers and save final state. */
  close(errored = false): void {
    if (this.closed) return;
    this.closed = true;
    process.removeListener("SIGINT", this.sigintHandler);
    if (this.sessionPath) this.context.save(this.sessionPath);
    this.saveToHistory();
    cleanupProcesses();
    cleanupSessions();
    resetCustomTools();
    resetModuleFactory();
    resetChangeTracker();
    resetGroups();
    this.moduleLoader.unloadAll().catch(() => {});
    this.mcpManager?.close().catch(() => {});
    if (this.sessionStartTime > 0) {
      tryEmit("session.end", {
        sessionId: this.sessionId,
        label: this.sessionLabel,
        error: errored ? "session errored" : undefined,
        durationMs: Date.now() - this.sessionStartTime,
      });
    }
    if (!errored) {
      this.transport.emit({ type: "status", message: `[kota] Done — ${this.costTracker.getSummary()}` });
    }
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
