import { describe, expect, it } from "vitest";
import { type AgentEvent, BufferTransport, NullTransport } from "./core/loop/transport.js";

describe("BufferTransport", () => {
  it("collects all events", () => {
    const t = new BufferTransport();
    t.emit({ type: "text", content: "hello" });
    t.emit({ type: "status", message: "[kota] starting" });
    t.emit({ type: "text", content: " world" });

    expect(t.events).toHaveLength(3);
    expect(t.getText()).toBe("hello world");
    expect(t.getStatusMessages()).toEqual(["[kota] starting"]);
  });

  it("clears events", () => {
    const t = new BufferTransport();
    t.emit({ type: "text", content: "data" });
    t.clear();
    expect(t.events).toHaveLength(0);
    expect(t.getText()).toBe("");
  });
});

describe("NullTransport", () => {
  it("discards all events without error", () => {
    const t = new NullTransport();
    t.emit({ type: "text", content: "ignored" });
    t.emit({ type: "status", message: "ignored" });
    t.emit({ type: "error", message: "ignored" });
    t.emit({ type: "thinking", content: "ignored" });
    t.emit({ type: "thinking_start" });
    t.emit({ type: "progress", content: "ignored" });
    t.emit({ type: "cost", summary: "ignored", budgetPercent: 50 });
  });
});

describe("Transport interface compatibility", () => {
  it("accepts any AgentEvent type", () => {
    const events: AgentEvent[] = [
      { type: "text", content: "a" },
      { type: "thinking", content: "b" },
      { type: "thinking_start" },
      { type: "progress", content: "c", source: "delegate" },
      { type: "status", message: "d" },
      { type: "cost", summary: "e", budgetPercent: 10 },
      { type: "error", message: "f" },
    ];

    const buf = new BufferTransport();
    for (const e of events) buf.emit(e);
    expect(buf.events).toHaveLength(events.length);
  });
});
