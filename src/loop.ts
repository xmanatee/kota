import Anthropic from "@anthropic-ai/sdk";
import { existsSync } from "node:fs";
import { allTools } from "./tools/index.js";
import { filterTools, detectToolGroups, enableGroup, resetGroups } from "./tool-groups.js";
import { Context, CONTEXT_WINDOW } from "./context.js";
import { CostTracker } from "./cost.js";
import { runArchitectStep } from "./architect-runner.js";
import { setDelegateConfig } from "./tools/delegate.js";
import { loadProjectContext } from "./project-context.js";
import { streamMessage } from "./streaming.js";
import { buildSessionWarmup } from "./init.js";
import { executeToolCalls, FailureTracker } from "./tool-runner.js";
import { VerifyTracker, detectVerifyCommands, processToolResults } from "./verify-tracker.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { McpManager } from "./mcp-manager.js";
import { PluginManager } from "./plugin-loader.js";
import { cleanupProcesses } from "./tools/process.js";
import { cleanupSessions } from "./tools/code-exec.js";
import { CliTransport, type Transport } from "./transport.js";
import { buildUserProfile, type KotaConfig } from "./config.js";
import { initTaskStore } from "./task-store.js";
import { initScheduler, getScheduler, resetScheduler } from "./scheduler.js";


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
  private pluginManager: PluginManager;
  private transport: Transport;
  private sigintHandler: () => void;
  private closed = false;
  private initialized = false;
  private initPromise: Promise<void>;

  constructor(options: LoopOptions = {}) {
    this.model = options.model || "claude-sonnet-4-6";
    this.editorModel = options.editorModel || this.model;
    this.maxTokens = options.maxTokens || 8192;
    this.verbose = options.verbose || false;
    this.architectMode = options.architectMode || false;
    this.sessionPath = options.sessionPath;
    this.transport = options.transport || new CliTransport(this.verbose);

    const thinkingBudget = options.thinkingBudget || 10_000;
    this.thinkingConfig = options.thinkingEnabled
      ? { type: "enabled", budget_tokens: thinkingBudget }
      : undefined;
    this.effectiveMaxTokens = options.thinkingEnabled
      ? thinkingBudget + this.maxTokens
      : this.maxTokens;

    this.client = new Anthropic({ maxRetries: 5 });
    this.costTracker = new CostTracker();

    // Initialize persistent stores for this project
    initTaskStore(process.cwd());
    initScheduler(process.cwd());

    const projectContext = loadProjectContext();
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

    if (this.sessionPath && existsSync(this.sessionPath)) {
      this.context = Context.load(this.sessionPath, systemPrompt);
      if (this.verbose) this.transport.emit({ type: "status", message: `[kota] Resumed session from ${this.sessionPath}` });
    } else {
      this.context = new Context(systemPrompt);
    }

    this.verifyTracker = new VerifyTracker(detectVerifyCommands());

    setDelegateConfig({
      model: this.editorModel,
      client: this.client,
      cwd: process.cwd(),
      projectContext: projectContext || undefined,
      costTracker: this.costTracker,
      transport: this.transport,
    });

    this.pluginManager = new PluginManager(this.verbose);

    this.initPromise = this.initExtensions();

    this.sigintHandler = () => {
      if (this.sessionPath) {
        this.context.save(this.sessionPath);
        this.transport.emit({ type: "status", message: "\n[kota] Session saved to " + this.sessionPath });
      }
      process.exit(0);
    };
    process.on("SIGINT", this.sigintHandler);
  }

  private async initExtensions(): Promise<void> {
    const config = McpManager.loadConfig();
    if (config) {
      this.mcpManager = new McpManager();
      await this.mcpManager.initialize(config);
      if (this.mcpManager.getToolCount() > 0 && this.verbose) {
        this.transport.emit({
          type: "status",
          message: `[kota] MCP: ${this.mcpManager.getServerCount()} server(s), ${this.mcpManager.getToolCount()} tool(s)`,
        });
      }
    }

    await this.pluginManager.loadAll();
    this.initialized = true;
  }

  /** Send a prompt and run the agent loop until the agent stops. */
  async send(prompt: string): Promise<string> {
    if (!this.initialized) await this.initPromise;

    this.context.addUserMessage(prompt);
    for (const g of detectToolGroups(prompt)) enableGroup(g);
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

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const pruneStats = this.context.maybePrune();
      if (pruneStats.prunedCount > 0) {
        this.transport.emit({
          type: "status",
          message: `[kota] Pruned ${pruneStats.prunedCount} old tool results (saved ~${Math.round(pruneStats.charsSaved / 4)} tokens)`,
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
      const dynamicState = this.context.getDynamicState() + this.verifyTracker.getState();
      if (dynamicState) {
        system.push({ type: "text", text: dynamicState });
      }

      // Progressive disclosure: filter built-in tools by active groups, include MCP tools
      const activeTools = [...filterTools(allTools), ...mcpTools];

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

      const postPrune = this.context.maybePrune();
      if (postPrune.prunedCount > 0) {
        this.transport.emit({
          type: "status",
          message: `[kota] Pruned ${postPrune.prunedCount} old tool results (saved ~${Math.round(postPrune.charsSaved / 4)} tokens)`,
        });
      }

      this.context.addAssistantMessage(response);

      const toolBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
      );
      if (toolBlocks.length === 0) break;

      const resultLimit = this.context.getToolResultLimit();
      const validResults = await executeToolCalls(
        toolBlocks, resultLimit, this.verbose, this.mcpManager ?? undefined, this.transport,
      );
      this.context.addToolResults(validResults);

      processToolResults(this.verifyTracker, toolBlocks, validResults);

      if (this.sessionPath) this.context.save(this.sessionPath);

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
    return lastResult;
  }

  /** Get cumulative cost summary string. */
  getCostSummary(): string {
    return this.costTracker.getSummary();
  }

  /** Clean up handlers and save final state. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    process.removeListener("SIGINT", this.sigintHandler);
    if (this.sessionPath) this.context.save(this.sessionPath);
    cleanupProcesses();
    cleanupSessions();
    resetGroups();
    resetScheduler();
    this.pluginManager.unloadAll().catch(() => {});
    this.mcpManager?.close().catch(() => {});
    this.transport.emit({ type: "status", message: `[kota] Done — ${this.costTracker.getSummary()}` });
  }
}

/** Convenience wrapper: create a session, send one prompt, close. */
export async function runAgentLoop(
  prompt: string,
  options: LoopOptions = {},
): Promise<string> {
  const session = new AgentSession(options);
  try {
    return await session.send(prompt);
  } finally {
    session.close();
  }
}
