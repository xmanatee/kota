import Anthropic from "@anthropic-ai/sdk";
import { existsSync } from "node:fs";
import { allTools } from "./tools/index.js";
import { Context, CONTEXT_WINDOW } from "./context.js";
import { CostTracker } from "./cost.js";
import { runArchitectPass, runEditorLoop } from "./architect.js";
import { setDelegateModel } from "./tools/delegate.js";
import { loadProjectContext } from "./project-context.js";
import { streamMessage } from "./streaming.js";
import { buildSessionWarmup } from "./init.js";
import { executeToolCalls, FailureTracker } from "./tool-runner.js";
import { VerifyTracker, detectVerifyCommands } from "./verify-tracker.js";

const SYSTEM_PROMPT = `You are KOTA, a capable AI assistant. You help with software engineering, research, analysis, and problem-solving.

## How you work
- Break complex tasks into steps using the todo tool.
- Read files before editing them. Understand existing code before modifying.
- After making changes, verify they work (run tests, type checks, builds).
- When uncertain about current APIs, libraries, or best practices, use web_fetch to verify.
- Be concise. Lead with the answer, not the reasoning.

## Tool strategy
- Use file_read to read files (not shell + cat).
- Use file_edit for modifying existing files (search-and-replace).
- Use file_write only for creating new files.
- Use grep to search code content, glob to find files by pattern.
- Use shell for builds, tests, git commands, installs.
- Use web_search to find documentation, research errors, discover libraries, and look up information.
- Use web_fetch to read a specific URL (e.g., one returned by web_search).
- Use delegate for exploring unfamiliar codebases or researching online without polluting context.
- Use repo_map to orient yourself in a new codebase.
- Use memory to save important facts for future sessions (preferences, conventions, decisions).
- At the start of a session, search memory for relevant context about the current project or user.
- Use ask_user when you need clarification, a decision, or information only the user can provide. Don't ask when you can figure it out yourself.

## Efficiency
- Batch independent tool calls in a single turn. E.g., read 3 files at once, or grep + glob together.
- Start with repo_map to orient, then targeted reads — avoid reading files one by one.
- Combine exploration into delegate calls to keep the main context clean.

## Error recovery
- When file_edit fails (string not found), re-read the file to get exact content.
- When a shell command fails, read the error, adjust, and retry with a different approach.
- If stuck after 3 attempts, use ask_user to explain what's going wrong and ask for guidance.

## Safety
- Never run destructive commands without confirming.
- Never modify files outside the project directory.`;

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
  private sigintHandler: () => void;
  private closed = false;

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

    setDelegateModel(this.editorModel);

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

  /** Send a prompt and run the agent loop until the agent stops. */
  async send(prompt: string): Promise<string> {
    this.context.addUserMessage(prompt);
    let lastResult = "";

    // Architect/Editor split: two-pass before the main verification loop
    if (this.architectMode) {
      const plan = await runArchitectPass(
        this.client, this.model, this.effectiveMaxTokens,
        this.context.getSystemPrompt(), this.context.getMessages(), this.verbose,
        this.thinkingConfig,
      );
      if (plan) {
        const editorResult = await runEditorLoop(
          this.client, this.editorModel, this.maxTokens, plan, this.verbose,
        );
        lastResult = editorResult || plan;
        this.context.addAssistantText(
          `[Architect/Editor completed]\n\nPlan executed:\n${plan.slice(0, 500)}` +
          (editorResult ? `\n\nEditor result: ${editorResult}` : ""),
        );
        this.context.addUserMessage(
          "The architect/editor has made changes. " +
          "Verify they are correct: run builds, tests, or type checks as appropriate.",
        );
      }
    }

    const failureTracker = new FailureTracker();

    for (let i = 0; i < MAX_ITERATIONS; i++) {
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
      const dynamicState = this.context.getDynamicState() + this.verifyTracker.getState();
      if (dynamicState) {
        system.push({ type: "text", text: dynamicState });
      }

      // Stream the response with retry for mid-stream failures
      const { response, streamedText } = await streamMessage({
        client: this.client,
        model: this.model,
        maxTokens: this.effectiveMaxTokens,
        system,
        messages: this.context.getMessages(),
        tools: allTools,
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

      this.context.addAssistantMessage(response);

      const toolBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
      );
      if (toolBlocks.length === 0) break;

      // Execute tool calls in parallel with budget-aware truncation
      const resultLimit = this.context.getToolResultLimit();
      const validResults = await executeToolCalls(toolBlocks, resultLimit, this.verbose);
      this.context.addToolResults(validResults);

      // Track edits and verifications for nudge system
      for (const block of toolBlocks) {
        const result = validResults.find((r) => r.tool_use_id === block.id);
        const input = block.input as Record<string, unknown>;
        if (result && !result.is_error) {
          if (block.name === "file_edit" || block.name === "file_write") {
            this.verifyTracker.recordEdit((input.path as string) || "");
          } else if (block.name === "multi_edit") {
            const edits = input.edits as Array<{ file_path?: string }> | undefined;
            if (edits) {
              for (const e of edits) {
                if (e.file_path) this.verifyTracker.recordEdit(e.file_path);
              }
            }
          }
        }
        if (block.name === "shell") {
          this.verifyTracker.checkShellCommand((input.command as string) || "");
        }
      }
      this.verifyTracker.tick();

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
