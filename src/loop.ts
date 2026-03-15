import Anthropic from "@anthropic-ai/sdk";
import { existsSync } from "node:fs";
import { allTools } from "./tools/index.js";
import { filterTools } from "./tool-groups.js";
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
import { cleanupProcesses } from "./tools/process.js";
import { cleanupSessions } from "./tools/code-exec.js";
import { getTodoState } from "./tools/todo.js";

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

    const thinkingBudget = options.thinkingBudget || 10_000;
    this.thinkingConfig = options.thinkingEnabled
      ? { type: "enabled", budget_tokens: thinkingBudget }
      : undefined;
    this.effectiveMaxTokens = options.thinkingEnabled
      ? thinkingBudget + this.maxTokens
      : this.maxTokens;

    // SDK auto-retries 429, 500, 502, 503, 504 on connection failures
    this.client = new Anthropic({ maxRetries: 5 });
    this.costTracker = new CostTracker();

    // Build system prompt with project context and session warmup
    const projectContext = loadProjectContext();
    const warmup = buildSessionWarmup();
    const systemPrompt = SYSTEM_PROMPT + projectContext + warmup;
    if (projectContext && this.verbose) {
      console.error("[kota] Loaded project context from .kota.md");
    }
    if (warmup && this.verbose) {
      console.error("[kota] Session warmup loaded");
    }

    // Load or create context
    if (this.sessionPath && existsSync(this.sessionPath)) {
      this.context = Context.load(this.sessionPath, systemPrompt);
      if (this.verbose) console.error(`[kota] Resumed session from ${this.sessionPath}`);
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
    });

    // Initialize MCP servers asynchronously (awaited before first send)
    this.initPromise = this.initMcp();

    // SIGINT handler: save session before exit
    this.sigintHandler = () => {
      if (this.sessionPath) {
        this.context.save(this.sessionPath);
        console.error(`\n[kota] Session saved to ${this.sessionPath}`);
      }
      process.exit(0);
    };
    process.on("SIGINT", this.sigintHandler);
  }

  private async initMcp(): Promise<void> {
    const config = McpManager.loadConfig();
    if (!config) {
      this.initialized = true;
      return;
    }
    this.mcpManager = new McpManager();
    await this.mcpManager.initialize(config);
    if (this.mcpManager.getToolCount() > 0 && this.verbose) {
      console.error(
        `[kota] MCP: ${this.mcpManager.getServerCount()} server(s), ${this.mcpManager.getToolCount()} tool(s)`,
      );
    }
    this.initialized = true;
  }

  /** Send a prompt and run the agent loop until the agent stops. */
  async send(prompt: string): Promise<string> {
    if (!this.initialized) await this.initPromise;

    this.context.addUserMessage(prompt);
    let lastResult = "";

    // MCP tools always included; built-in tools filtered by active groups
    const mcpTools = this.mcpManager ? this.mcpManager.getTools() : [];

    // Architect/Editor split: two-pass before the main verification loop
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
      });
      if (result) {
        lastResult = result.lastResult;
        this.context.addAssistantText(result.summary);
        this.context.addUserMessage(
          "The architect/editor has made changes. " +
          "Verify they are correct: run builds, tests, or type checks as appropriate.",
        );
      }
    }

    const failureTracker = new FailureTracker();

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      // Prune old read-only tool results before checking compaction
      const pruneStats = this.context.maybePrune();
      if (pruneStats.prunedCount > 0) {
        console.error(
          `[kota] Pruned ${pruneStats.prunedCount} old tool results (saved ~${Math.round(pruneStats.charsSaved / 4)} tokens)`,
        );
      }

      if (this.context.needsCompaction()) {
        if (this.verbose) console.error("[kota] Compacting context...");
        await this.context.compact(this.client, this.model);
      }

      if (this.verbose) {
        const stats = this.context.getStats();
        console.error(
          `[kota] Turn ${i + 1} (${stats.turns} messages, ${stats.compactions} compactions)`,
        );
      }

      // Build system blocks: static prompt (cached) + dynamic state (uncached)
      const system: Anthropic.Messages.TextBlockParam[] = [
        { type: "text", text: this.context.getStaticPrompt(), cache_control: { type: "ephemeral" } },
      ];
      const dynamicState = this.context.getDynamicState() + this.verifyTracker.getState() + getTodoState();
      if (dynamicState) {
        system.push({ type: "text", text: dynamicState });
      }

      // Progressive disclosure: filter built-in tools by active groups, include MCP tools
      const activeTools = [...filterTools(allTools), ...mcpTools];

      // Stream the response with retry for mid-stream failures
      const { response, streamedText } = await streamMessage({
        client: this.client,
        model: this.model,
        maxTokens: this.effectiveMaxTokens,
        system,
        messages: this.context.getMessages(),
        tools: activeTools,
        thinkingConfig: this.thinkingConfig,
        verbose: this.verbose,
      });

      if (streamedText) {
        process.stdout.write("\n");
        lastResult = streamedText;
      }

      // Track token usage for compaction decisions and cost
      this.context.setInputTokens(response.usage.input_tokens);
      this.costTracker.addUsage(this.model, response.usage);
      const budgetPct = Math.round(this.context.getBudgetPercent() * 100);
      console.error(
        `[kota] Turn ${i + 1} \u2014 ${this.costTracker.getSummary()} \u2014 context: ${budgetPct}%`,
      );

      if (this.verbose) {
        const u = response.usage;
        console.error(
          `[kota] Tokens: input=${u.input_tokens}/${CONTEXT_WINDOW}` +
          (u.cache_read_input_tokens ? `, cache_read=${u.cache_read_input_tokens}` : "") +
          (u.cache_creation_input_tokens ? `, cache_created=${u.cache_creation_input_tokens}` : ""),
        );
      }

      // Prune with fresh token count — fixes one-turn-late pruning
      const postPrune = this.context.maybePrune();
      if (postPrune.prunedCount > 0) {
        console.error(
          `[kota] Pruned ${postPrune.prunedCount} old tool results (saved ~${Math.round(postPrune.charsSaved / 4)} tokens)`,
        );
      }

      this.context.addAssistantMessage(response);

      const toolBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
      );
      if (toolBlocks.length === 0) break;

      // Execute tool calls in parallel with budget-aware truncation
      const resultLimit = this.context.getToolResultLimit();
      const validResults = await executeToolCalls(
        toolBlocks, resultLimit, this.verbose, this.mcpManager ?? undefined,
      );
      this.context.addToolResults(validResults);

      processToolResults(this.verifyTracker, toolBlocks, validResults);

      if (this.sessionPath) this.context.save(this.sessionPath);

      // Failure tracking: detect stuck loops (identical or diverse failures)
      const action = failureTracker.record(validResults);
      if (action !== "continue") {
        const msg = FailureTracker.getMessage(action);
        console.error(`[kota] ${action === "circuit_break" ? "Circuit breaker" : "Failure guidance"}: ${msg}`);
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
    this.mcpManager?.close().catch(() => {});
    console.error(`[kota] Done \u2014 ${this.costTracker.getSummary()}`);
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
