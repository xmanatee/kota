/**
 * Vercel AI SDK Data Stream Protocol (v1) transport.
 *
 * Translates KOTA's AgentEvents into the wire format expected by
 * `useChat()` from the Vercel AI SDK: `{TYPE_CODE}:{JSON}\n`.
 *
 * Protocol codes used:
 *   0: text delta
 *   2: data annotation (status/cost metadata)
 *   3: error
 *   9: tool call (toolCallId, toolName, args)
 *   a: tool result (toolCallId, result)
 *   d: finish message (finishReason, usage)
 *   e: finish step (finishReason, usage, isContinued)
 *   g: reasoning (thinking/extended thinking)
 */

import type { ServerResponse } from "node:http";
import type { AgentEvent, Transport } from "#core/loop/transport.js";

/** Writes AgentEvents as Vercel AI SDK Data Stream Protocol v1 lines. */
export class DataStreamTransport implements Transport {
  private closed = false;

  constructor(private res: ServerResponse) {
    res.on("close", () => { this.closed = true; });
  }

  emit(event: AgentEvent): void {
    if (this.closed) return;

    switch (event.type) {
      case "text":
        this.write(`0:${JSON.stringify(event.content)}\n`);
        break;
      case "thinking":
        if (event.content) {
          this.write(`g:${JSON.stringify(event.content)}\n`);
        }
        break;
      case "thinking_start":
        // No direct mapping — reasoning content comes via "thinking" events
        break;
      case "status":
        this.write(`2:${JSON.stringify([{ type: "status", message: event.message }])}\n`);
        break;
      case "cost":
        this.write(`2:${JSON.stringify([{ type: "cost", summary: event.summary, budgetPercent: event.budgetPercent }])}\n`);
        break;
      case "error":
        this.write(`3:${JSON.stringify(event.message)}\n`);
        break;
      // progress, notification — not mapped to protocol
    }
  }

  /** Emit a tool call event visible to the frontend. */
  toolCall(toolCallId: string, toolName: string, args: Record<string, unknown>): void {
    if (this.closed) return;
    this.write(`9:${JSON.stringify({ toolCallId, toolName, args })}\n`);
  }

  /** Emit a tool result event visible to the frontend. */
  toolResult(toolCallId: string, result: unknown): void {
    if (this.closed) return;
    this.write(`a:${JSON.stringify({ toolCallId, result })}\n`);
  }

  /** Send a finish-step marker (used between agent loop iterations). */
  finishStep(finishReason: string, usage?: { promptTokens: number; completionTokens: number }): void {
    if (this.closed) return;
    this.write(`e:${JSON.stringify({
      finishReason,
      usage: usage ?? { promptTokens: 0, completionTokens: 0 },
      isContinued: finishReason === "tool-calls",
    })}\n`);
  }

  /** Send the final finish message and end the stream. */
  finish(usage?: { promptTokens: number; completionTokens: number }): void {
    if (this.closed) return;
    this.write(`d:${JSON.stringify({
      finishReason: "stop",
      usage: usage ?? { promptTokens: 0, completionTokens: 0 },
    })}\n`);
    this.closed = true;
    this.res.end();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private write(data: string): void {
    if (!this.closed) this.res.write(data);
  }
}

/** HTTP headers required for the Data Stream Protocol v1. */
export const DATA_STREAM_HEADERS: Record<string, string> = {
  "Content-Type": "text/plain; charset=utf-8",
  "X-Vercel-AI-Data-Stream": "v1",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

/**
 * Extract the last user message from a Vercel AI SDK messages array.
 * Returns undefined if no user message is found.
 */
export function extractLastUserMessage(
  messages: Array<{ role: string; content: string }>,
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return undefined;
}
