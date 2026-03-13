import type Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import { getTodoState } from "./tools/index.js";
import { compactMessages } from "./compaction.js";
import { pruneMessages, type PruneStats } from "./message-pruning.js";

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

  /** Dynamic state (todos + budget) — changes per turn, not cached. */
  getDynamicState(): string {
    const todoState = getTodoState();
    const pct = this.getBudgetPercent();
    if (pct <= 0.5) return todoState;
    const usedK = Math.round(this.lastInputTokens / 1000);
    const maxK = Math.round(CONTEXT_WINDOW / 1000);
    const pctStr = Math.round(pct * 100);
    const severity = pct > 0.75
      ? "CRITICAL: finish current task, avoid large reads"
      : "be concise, use targeted file reads with offset/limit";
    return todoState + `\n\n[Context budget: ${pctStr}% used (${usedK}K/${maxK}K tokens) — ${severity}]`;
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
      is_error?: boolean;
    }>,
  ): void {
    this.messages.push({
      role: "user",
      content: results.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.tool_use_id,
        content: r.content,
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
   * Compact conversation history by summarizing older turns.
   * Uses structured state extraction + LLM narrative summary.
   * Keeps the most recent turns intact for context continuity.
   */
  async compact(
    client: Anthropic,
    model: string,
  ): Promise<void> {
    if (this.messages.length <= 10) return;

    const keepRecent = 10;
    const toSummarize = this.messages.slice(0, -keepRecent);
    const recentMessages = this.messages.slice(-keepRecent);

    this.compactionCount++;
    const compacted = await compactMessages(client, model, toSummarize, this.compactionCount);
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

  save(path: string): void {
    const data: SessionData = {
      messages: this.messages,
      compactionCount: this.compactionCount,
      lastInputTokens: this.lastInputTokens,
    };
    writeFileSync(path, JSON.stringify(data), "utf-8");
  }

  static load(path: string, systemPrompt: string): Context {
    const raw = readFileSync(path, "utf-8");
    const data: SessionData = JSON.parse(raw);
    const ctx = new Context(systemPrompt);
    ctx.messages = data.messages;
    ctx.compactionCount = data.compactionCount;
    ctx.lastInputTokens = data.lastInputTokens;
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
