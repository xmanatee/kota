import Anthropic from "@anthropic-ai/sdk";
import { existsSync } from "node:fs";
import { allTools, executeTool } from "./tools/index.js";
import { Context } from "./context.js";
import { CostTracker } from "./cost.js";
import { runArchitectPass, runEditorLoop } from "./architect.js";
import { setDelegateModel } from "./tools/delegate.js";
import { loadProjectContext } from "./project-context.js";

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
- Use delegate for exploring unfamiliar codebases without polluting context.
- Use repo_map to orient yourself in a new codebase.
- Use memory to save important facts for future sessions (preferences, conventions, decisions).
- At the start of a session, search memory for relevant context about the current project or user.

## Error recovery
- When file_edit fails (string not found), re-read the file to get exact content.
- When a shell command fails, read the error, adjust, and retry with a different approach.
- If stuck after 3 attempts, explain the situation and ask for help.

## Safety
- Never run destructive commands without confirming.
- Never modify files outside the project directory.`;

const MAX_ITERATIONS = 200;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const STREAM_MAX_RETRIES = 3;

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

/** Build system prompt as cacheable content blocks */
function systemBlocks(text: string): Anthropic.Messages.TextBlockParam[] {
  return [
    { type: "text", text, cache_control: { type: "ephemeral" } },
  ];
}

/** Sleep with jittered exponential backoff for retries */
function backoff(attempt: number): Promise<void> {
  const delay = Math.min(1000 * 2 ** attempt, 10_000) + Math.random() * 1000;
  return new Promise((r) => setTimeout(r, delay));
}

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

    // Build system prompt with project context
    const projectContext = loadProjectContext();
    const systemPrompt = SYSTEM_PROMPT + projectContext;
    if (projectContext && this.verbose) {
      console.error("[kota] Loaded project context from .kota.md");
    }

    // Load or create context
    if (this.sessionPath && existsSync(this.sessionPath)) {
      this.context = Context.load(this.sessionPath, systemPrompt);
      if (this.verbose) console.error(`[kota] Resumed session from ${this.sessionPath}`);
    } else {
      this.context = new Context(systemPrompt);
    }

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

    let consecutiveFailures = 0;
    let lastFailureSignature = "";

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

      // Stream the response with retry for mid-stream failures
      const { response, streamedText } = await this.streamWithRetry();
      if (streamedText) {
        process.stdout.write("\n");
        lastResult = streamedText;
      }

      // Track token usage for compaction decisions and cost
      this.context.setInputTokens(response.usage.input_tokens);
      this.costTracker.addUsage(this.model, response.usage);
      console.error(`[kota] Turn ${i + 1} \u2014 ${this.costTracker.getSummary()}`);

      if (this.verbose) {
        const u = response.usage;
        console.error(
          `[kota] Tokens: input=${u.input_tokens}/150000` +
          (u.cache_read_input_tokens ? `, cache_read=${u.cache_read_input_tokens}` : "") +
          (u.cache_creation_input_tokens ? `, cache_created=${u.cache_creation_input_tokens}` : ""),
        );
      }

      this.context.addAssistantMessage(response);

      const toolBlocks = response.content.filter((b) => b.type === "tool_use");
      if (toolBlocks.length === 0) break;

      // Execute tool calls in parallel
      const results = await Promise.all(
        toolBlocks.map(async (block) => {
          if (block.type !== "tool_use") return null;
          if (this.verbose) {
            console.error(
              `[kota] Tool: ${block.name}(${JSON.stringify(block.input).slice(0, 100)}...)`,
            );
          }
          const result = await executeTool(
            block.name,
            block.input as Record<string, unknown>,
          );
          return { tool_use_id: block.id, content: result.content, is_error: result.is_error };
        }),
      );

      const validResults = results.filter(
        (r): r is NonNullable<typeof r> => r !== null,
      );
      this.context.addToolResults(validResults);

      if (this.sessionPath) this.context.save(this.sessionPath);

      // Circuit breaker: detect repeated identical failures
      const failedResults = validResults.filter((r) => r.is_error);
      if (failedResults.length > 0) {
        const sig = failedResults.map((r) => r.content).join("|");
        if (sig === lastFailureSignature) {
          consecutiveFailures++;
          if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
            console.error(
              `[kota] Circuit breaker: ${CIRCUIT_BREAKER_THRESHOLD} identical failures. Stopping.`,
            );
            this.context.addUserMessage(
              "You have failed the same way 3 times in a row. " +
              "Stop and explain what's going wrong.",
            );
          }
        } else {
          consecutiveFailures = 1;
          lastFailureSignature = sig;
        }
      } else {
        consecutiveFailures = 0;
        lastFailureSignature = "";
      }
    }

    if (this.sessionPath) this.context.save(this.sessionPath);
    return lastResult;
  }

  /** Check if an error is worth retrying (transient) vs permanent. */
  private isRetryable(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    // Auth/config errors are permanent
    if (msg.includes("authentication") || msg.includes("apiKey") || msg.includes("authToken")) {
      return false;
    }
    // 4xx client errors (except 429 rate limit) are permanent
    const status = (err as { status?: number }).status;
    if (typeof status === "number" && status >= 400 && status < 500 && status !== 429) {
      return false;
    }
    return true;
  }

  /** Stream an API call with retry for mid-stream failures. */
  private async streamWithRetry(): Promise<{
    response: Anthropic.Message;
    streamedText: string;
  }> {
    for (let attempt = 0; attempt <= STREAM_MAX_RETRIES; attempt++) {
      try {
        let streamedText = "";
        const stream = this.client.messages.stream({
          model: this.model,
          max_tokens: this.effectiveMaxTokens,
          system: systemBlocks(this.context.getSystemPrompt()),
          tools: allTools,
          messages: this.context.getMessages(),
          ...(this.thinkingConfig && { thinking: this.thinkingConfig }),
        });

        if (this.thinkingConfig) {
          let thinkingStarted = false;
          stream.on("thinking", (delta) => {
            if (!thinkingStarted) {
              thinkingStarted = true;
              if (this.verbose) {
                process.stderr.write("[thinking] ");
              } else {
                process.stderr.write("[kota] Thinking...\n");
              }
            }
            if (this.verbose) process.stderr.write(delta);
          });
        }

        stream.on("text", (text) => {
          process.stdout.write(text);
          streamedText += text;
        });

        const response = await stream.finalMessage();
        return { response, streamedText };
      } catch (err) {
        if (attempt === STREAM_MAX_RETRIES || !this.isRetryable(err)) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `\n[kota] Stream error (attempt ${attempt + 1}/${STREAM_MAX_RETRIES + 1}): ${msg}`,
        );
        await backoff(attempt);
        console.error("[kota] Retrying...");
      }
    }
    throw new Error("unreachable");
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
