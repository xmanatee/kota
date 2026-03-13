import type Anthropic from "@anthropic-ai/sdk";
import { getTodoState } from "./tools/index.js";

type Message = Anthropic.MessageParam;

const TOKEN_COMPACTION_THRESHOLD = 150_000; // 75% of 200K context window
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
   * Compact conversation history by summarizing older turns.
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

    // Build a summary of older conversation
    const summaryContent = toSummarize
      .map((m) => {
        if (typeof m.content === "string") {
          return `[${m.role}]: ${m.content.slice(0, 500)}`;
        }
        // Handle array content (tool results, etc.)
        return `[${m.role}]: (structured content)`;
      })
      .join("\n");

    try {
      const summaryResponse = await client.messages.create({
        model,
        max_tokens: 1024,
        system:
          "Summarize the following conversation history concisely. " +
          "Focus on: what was accomplished, what files were modified, " +
          "what decisions were made, and what remains to be done. " +
          "Be brief but preserve key details.",
        messages: [{ role: "user", content: summaryContent }],
      });

      const summaryText =
        summaryResponse.content[0].type === "text"
          ? summaryResponse.content[0].text
          : "Summary unavailable";

      this.compactionCount++;
      this.messages = [
        {
          role: "user",
          content:
            `[Context compaction #${this.compactionCount} — ` +
            `${toSummarize.length} turns summarized]\n\n${summaryText}`,
        },
        { role: "assistant", content: "Understood. I have the context. Continuing." },
        ...recentMessages,
      ];
    } catch {
      // If compaction fails, just trim oldest messages
      this.messages = recentMessages;
    }
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
}
