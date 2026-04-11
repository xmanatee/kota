import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { DATA_STREAM_HEADERS, DataStreamTransport, extractLastUserMessage } from "./data-stream.js";

function mockResponse(): { res: ServerResponse; chunks: string[]; closeHandlers: Array<() => void> } {
  const chunks: string[] = [];
  const closeHandlers: Array<() => void> = [];
  const res = {
    write: (data: string) => { chunks.push(data); return true; },
    end: vi.fn(),
    on: (_event: string, handler: () => void) => {
      if (_event === "close") closeHandlers.push(handler);
      return res;
    },
  } as unknown as ServerResponse;
  return { res, chunks, closeHandlers };
}

describe("DataStreamTransport", () => {
  it("formats text events as 0: prefix", () => {
    const { res, chunks } = mockResponse();
    const t = new DataStreamTransport(res);
    t.emit({ type: "text", content: "Hello" });
    expect(chunks).toEqual(['0:"Hello"\n']);
  });

  it("escapes special characters in text", () => {
    const { res, chunks } = mockResponse();
    const t = new DataStreamTransport(res);
    t.emit({ type: "text", content: 'line1\nline2"quoted"' });
    expect(chunks[0]).toBe('0:"line1\\nline2\\"quoted\\""\n');
  });

  it("formats thinking events as g: prefix", () => {
    const { res, chunks } = mockResponse();
    const t = new DataStreamTransport(res);
    t.emit({ type: "thinking", content: "Let me consider..." });
    expect(chunks).toEqual(['g:"Let me consider..."\n']);
  });

  it("skips empty thinking events", () => {
    const { res, chunks } = mockResponse();
    const t = new DataStreamTransport(res);
    t.emit({ type: "thinking", content: "" });
    expect(chunks).toHaveLength(0);
  });

  it("skips thinking_start events", () => {
    const { res, chunks } = mockResponse();
    const t = new DataStreamTransport(res);
    t.emit({ type: "thinking_start" });
    expect(chunks).toHaveLength(0);
  });

  it("formats status events as 2: data annotations", () => {
    const { res, chunks } = mockResponse();
    const t = new DataStreamTransport(res);
    t.emit({ type: "status", message: "[kota] Turn 1" });
    const parsed = JSON.parse(chunks[0].slice(2));
    expect(parsed).toEqual([{ type: "status", message: "[kota] Turn 1" }]);
  });

  it("formats cost events as 2: data annotations", () => {
    const { res, chunks } = mockResponse();
    const t = new DataStreamTransport(res);
    t.emit({ type: "cost", summary: "$0.01", budgetPercent: 25 });
    const parsed = JSON.parse(chunks[0].slice(2));
    expect(parsed).toEqual([{ type: "cost", summary: "$0.01", budgetPercent: 25 }]);
  });

  it("formats error events as 3: prefix", () => {
    const { res, chunks } = mockResponse();
    const t = new DataStreamTransport(res);
    t.emit({ type: "error", message: "Something failed" });
    expect(chunks).toEqual(['3:"Something failed"\n']);
  });

  it("ignores progress events", () => {
    const { res, chunks } = mockResponse();
    const t = new DataStreamTransport(res);
    t.emit({ type: "progress", content: "sub-agent working..." });
    expect(chunks).toHaveLength(0);
  });

  it("emits tool call as 9: prefix", () => {
    const { res, chunks } = mockResponse();
    const t = new DataStreamTransport(res);
    t.toolCall("call-1", "get_weather", { city: "NYC" });
    const parsed = JSON.parse(chunks[0].slice(2));
    expect(parsed).toEqual({ toolCallId: "call-1", toolName: "get_weather", args: { city: "NYC" } });
  });

  it("emits tool result as a: prefix", () => {
    const { res, chunks } = mockResponse();
    const t = new DataStreamTransport(res);
    t.toolResult("call-1", "72F sunny");
    const parsed = JSON.parse(chunks[0].slice(2));
    expect(parsed).toEqual({ toolCallId: "call-1", result: "72F sunny" });
  });

  it("emits finish step as e: prefix", () => {
    const { res, chunks } = mockResponse();
    const t = new DataStreamTransport(res);
    t.finishStep("tool-calls", { promptTokens: 10, completionTokens: 5 });
    const parsed = JSON.parse(chunks[0].slice(2));
    expect(parsed).toEqual({
      finishReason: "tool-calls",
      usage: { promptTokens: 10, completionTokens: 5 },
      isContinued: true,
    });
  });

  it("emits finish step with isContinued=false for stop", () => {
    const { res, chunks } = mockResponse();
    const t = new DataStreamTransport(res);
    t.finishStep("stop");
    const parsed = JSON.parse(chunks[0].slice(2));
    expect(parsed.isContinued).toBe(false);
    expect(parsed.finishReason).toBe("stop");
  });

  it("emits finish message as d: prefix and ends response", () => {
    const { res, chunks } = mockResponse();
    const t = new DataStreamTransport(res);
    t.finish({ promptTokens: 100, completionTokens: 50 });
    const parsed = JSON.parse(chunks[0].slice(2));
    expect(parsed).toEqual({
      finishReason: "stop",
      usage: { promptTokens: 100, completionTokens: 50 },
    });
    expect(res.end).toHaveBeenCalled();
    expect(t.isClosed).toBe(true);
  });

  it("defaults usage to zeros when not provided", () => {
    const { res, chunks } = mockResponse();
    const t = new DataStreamTransport(res);
    t.finish();
    const parsed = JSON.parse(chunks[0].slice(2));
    expect(parsed.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
  });

  it("stops writing after close", () => {
    const { res, chunks, closeHandlers } = mockResponse();
    const t = new DataStreamTransport(res);
    closeHandlers[0](); // Simulate client disconnect
    t.emit({ type: "text", content: "should not appear" });
    expect(chunks).toHaveLength(0);
  });

  it("stops writing after finish", () => {
    const { res, chunks } = mockResponse();
    const t = new DataStreamTransport(res);
    t.finish();
    t.emit({ type: "text", content: "after finish" });
    expect(chunks).toHaveLength(1); // Only the finish message
  });

  it("handles a realistic multi-event sequence", () => {
    const { res, chunks } = mockResponse();
    const t = new DataStreamTransport(res);

    t.emit({ type: "text", content: "Let me " });
    t.emit({ type: "text", content: "check that." });
    t.toolCall("call-1", "web_search", { query: "weather NYC" });
    t.toolResult("call-1", "72F, sunny");
    t.finishStep("tool-calls");
    t.emit({ type: "text", content: "The weather is 72F." });
    t.finishStep("stop");
    t.finish({ promptTokens: 200, completionTokens: 80 });

    // Verify sequence: 2 text + 1 tool call + 1 tool result + 2 finish steps + 1 text + 1 finish
    expect(chunks).toHaveLength(8);
    expect(chunks[0]).toMatch(/^0:/);
    expect(chunks[1]).toMatch(/^0:/);
    expect(chunks[2]).toMatch(/^9:/);
    expect(chunks[3]).toMatch(/^a:/);
    expect(chunks[4]).toMatch(/^e:/);
    expect(chunks[5]).toMatch(/^0:/);
    expect(chunks[6]).toMatch(/^e:/);
    expect(chunks[7]).toMatch(/^d:/);
  });
});

describe("DATA_STREAM_HEADERS", () => {
  it("has correct content type", () => {
    expect(DATA_STREAM_HEADERS["Content-Type"]).toBe("text/plain; charset=utf-8");
  });

  it("has protocol version header", () => {
    expect(DATA_STREAM_HEADERS["X-Vercel-AI-Data-Stream"]).toBe("v1");
  });
});

describe("extractLastUserMessage", () => {
  it("returns the last user message", () => {
    const messages = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
      { role: "user", content: "What's the weather?" },
    ];
    expect(extractLastUserMessage(messages)).toBe("What's the weather?");
  });

  it("returns undefined for empty array", () => {
    expect(extractLastUserMessage([])).toBeUndefined();
  });

  it("returns undefined when no user messages", () => {
    const messages = [
      { role: "assistant", content: "Hi!" },
      { role: "system", content: "You are helpful" },
    ];
    expect(extractLastUserMessage(messages)).toBeUndefined();
  });

  it("skips trailing assistant messages", () => {
    const messages = [
      { role: "user", content: "First" },
      { role: "user", content: "Second" },
      { role: "assistant", content: "Response" },
    ];
    expect(extractLastUserMessage(messages)).toBe("Second");
  });
});
