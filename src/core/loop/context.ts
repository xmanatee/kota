import { readFileSync, writeFileSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import { compactMessages } from "#core/memory/compaction.js";
import { type MaskStats, maskObservations } from "#root/observation-masking.js";
import type { ModelClient } from "#core/model/model-client.js";
import type { ToolResultBlock } from "#core/tools/index.js";
import { getTodoState } from "#core/tools/index.js";
import { type PruneStats, pruneMessages } from "./message-pruning.js";

type Message = Anthropic.MessageParam;

type SessionData = {
  messages: Message[];
  compactionCount: number;
  lastInputTokens: number;
};

export const CONTEXT_WINDOW = 200_000;
const TOKEN_COMPACTION_THRESHOLD = 150_000; // 75% of context window
const MESSAGE_COMPACTION_SAFETY = 100; // Safety net for message count

export class Context {
  private systemPrompt: string;
  private messages: Message[] = [];
  private compactionCount = 0;
  private lastInputTokens = 0;

  constructor(systemPrompt: string) {
    this.systemPrompt = systemPrompt;
  }

  /** Append additional sections to the system prompt (e.g. module contributions). */
  appendSystemPrompt(section: string): void {
    this.systemPrompt += section;
  }

  setInputTokens(tokens: number): void {
    this.lastInputTokens = tokens;
  }

  getInputTokens(): number {
    return this.lastInputTokens;
  }

  getSystemPrompt(): string {
    const todoState = getTodoState();
    return this.systemPrompt + todoState;
  }

  /** Base system prompt without dynamic state — cacheable across turns. */
  getStaticPrompt(): string {
    return this.systemPrompt;
  }

  /** Dynamic state (time + todos + budget) — changes per turn, not cached. */
  getDynamicState(): string {
    const now = new Date();
    const timeLine = `[Current time: ${now.toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}]`;
    const todoState = getTodoState();
    const pct = this.getBudgetPercent();
    if (pct <= 0.5) return timeLine + todoState;
    const usedK = Math.round(this.lastInputTokens / 1000);
    const maxK = Math.round(CONTEXT_WINDOW / 1000);
    const pctStr = Math.round(pct * 100);
    const severity = pct > 0.75
      ? "CRITICAL: finish current task, avoid large reads"
      : "be concise, use targeted file reads with offset/limit";
    return `${timeLine + todoState}\n\n[Context budget: ${pctStr}% used (${usedK}K/${maxK}K tokens) — ${severity}]`;
  }

  getBudgetPercent(): number {
    if (this.lastInputTokens === 0) return 0;
    return this.lastInputTokens / CONTEXT_WINDOW;
  }

  /** Max chars for a single tool result based on remaining budget. */
  getToolResultLimit(): number {
    const pct = this.getBudgetPercent();
    if (pct > 0.75) return 5_000;
    if (pct > 0.50) return 15_000;
    return 50_000;
  }

  getMessages(): Message[] {
    return this.messages;
  }

  addUserMessage(content: string): void {
    this.messages.push({ role: "user", content });
  }

  addAssistantMessage(message: Anthropic.Message): void {
    this.messages.push({
      role: "assistant",
      content: message.content,
    });
  }

  addAssistantText(text: string): void {
    this.messages.push({ role: "assistant", content: text });
  }

  addToolResults(
    results: Array<{
      tool_use_id: string;
      content: string;
      blocks?: ToolResultBlock[];
      is_error?: boolean;
    }>,
  ): void {
    this.messages.push({
      role: "user",
      content: results.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.tool_use_id,
        content: r.blocks
          ? (r.blocks as Anthropic.Messages.ToolResultBlockParam["content"])
          : r.content,
        is_error: r.is_error,
      })),
    });
  }

  needsCompaction(): boolean {
    return (
      this.lastInputTokens > TOKEN_COMPACTION_THRESHOLD ||
      this.messages.length > MESSAGE_COMPACTION_SAFETY
    );
  }

  /**
   * Prune large read-only tool results from older messages when context budget
   * exceeds 50%. This is lighter than full compaction — it preserves conversation
   * structure and replaces content with compact summaries. Runs before compaction
   * to delay or avoid the more lossy full summarization.
   */
  maybePrune(): PruneStats {
    if (this.getBudgetPercent() < 0.5) return { prunedCount: 0, charsSaved: 0 };
    return pruneMessages(this.messages);
  }

  /**
   * Always-on observation masking: replace old tool outputs with compact
   * placeholders. Based on JetBrains research (NeurIPS 2025) — cuts context
   * ~50% with no performance loss. Runs every turn at zero LLM cost.
   */
  maskOldObservations(): MaskStats {
    return maskObservations(this.messages);
  }

  /**
   * Compact conversation history by summarizing older turns.
   * Uses structured state extraction + LLM narrative summary.
   * Keeps the most recent turns intact for context continuity.
   */
  async compact(
    client: ModelClient,
    model: string,
  ): Promise<void> {
    if (this.messages.length <= 10) return;

    // compactMessages() returns [user, assistant]. To maintain valid alternation,
    // recentMessages must start with a "user" message. Adjust keepRecent if needed.
    let keepRecent = 10;
    const startIdx = this.messages.length - keepRecent;
    if (startIdx > 0 && this.messages[startIdx].role === "assistant") {
      keepRecent++;
    }

    const toSummarize = this.messages.slice(0, -keepRecent);
    if (toSummarize.length === 0) return;

    const recentMessages = this.messages.slice(-keepRecent);
    const nextCount = this.compactionCount + 1;

    const compacted = await compactMessages(client, model, toSummarize, nextCount);
    this.compactionCount = nextCount;
    this.messages = [...compacted, ...recentMessages];
  }

  getTurnCount(): number {
    return this.messages.length;
  }

  getStats(): { turns: number; compactions: number; inputTokens: number } {
    return {
      turns: this.messages.length,
      compactions: this.compactionCount,
      inputTokens: this.lastInputTokens,
    };
  }

  /** Restore conversation state from saved data. */
  restoreFrom(messages: Message[], compactionCount: number, lastInputTokens: number): void {
    this.messages = messages;
    this.compactionCount = compactionCount;
    this.lastInputTokens = lastInputTokens;
  }

  /** Get a snapshot of conversation state for external persistence. */
  snapshot(): { messages: Message[]; compactionCount: number; lastInputTokens: number } {
    return {
      messages: this.messages,
      compactionCount: this.compactionCount,
      lastInputTokens: this.lastInputTokens,
    };
  }

  save(path: string): void {
    const data: SessionData = {
      messages: this.messages,
      compactionCount: this.compactionCount,
      lastInputTokens: this.lastInputTokens,
    };
    try {
      writeFileSync(path, JSON.stringify(data), "utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[kota] Failed to save session context to ${path}: ${msg}`);
    }
  }

  static load(path: string, systemPrompt: string): Context {
    let raw: string;
    try {
      raw = readFileSync(path, "utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[kota] Failed to read session context from ${path}: ${msg}`);
      return new Context(systemPrompt);
    }
    let data: SessionData;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[kota] Failed to parse session context from ${path}: ${msg}`);
      return new Context(systemPrompt);
    }
    const ctx = new Context(systemPrompt);
    ctx.messages = Array.isArray(data.messages) ? data.messages : [];
    ctx.compactionCount = typeof data.compactionCount === "number" ? data.compactionCount : 0;
    ctx.lastInputTokens = typeof data.lastInputTokens === "number" ? data.lastInputTokens : 0;
    return ctx;
  }
}

/** Truncate a tool result when context budget is tight. Keeps head + tail with notice. */
export function truncateToolResult(content: string, limit: number): string {
  if (content.length <= limit) return content;
  const keepStart = Math.floor(limit * 0.6);
  const keepEnd = Math.floor(limit * 0.3);
  const omitted = content.length - keepStart - keepEnd;
  return (
    content.slice(0, keepStart) +
    `\n\n[... ${omitted} chars omitted — context budget tight, re-read with offset/limit for specific sections ...]\n\n` +
    content.slice(-keepEnd)
  );
}
