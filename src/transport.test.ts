import { describe, it, expect, vi } from "vitest";
import { CliTransport, NullTransport, BufferTransport, type AgentEvent } from "./transport.js";

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

describe("CliTransport", () => {
  it("routes text events to stdout", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const t = new CliTransport();
    t.emit({ type: "text", content: "hello" });
    expect(write).toHaveBeenCalledWith("hello");
    write.mockRestore();
  });

  it("routes status events to stderr", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = new CliTransport();
    t.emit({ type: "status", message: "[kota] test" });
    expect(error).toHaveBeenCalledWith("[kota] test");
    error.mockRestore();
  });

  it("routes progress events to stderr", () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const t = new CliTransport();
    t.emit({ type: "progress", content: "sub-agent output" });
    expect(write).toHaveBeenCalledWith("sub-agent output");
    write.mockRestore();
  });

  it("shows thinking in verbose mode", () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const t = new CliTransport(true);
    t.emit({ type: "thinking", content: "reasoning..." });
    expect(write).toHaveBeenCalledWith("reasoning...");
    write.mockRestore();
  });

  it("suppresses thinking in non-verbose mode", () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const t = new CliTransport(false);
    t.emit({ type: "thinking", content: "reasoning..." });
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });

  it("emits thinking_start differently based on verbose", () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const verbose = new CliTransport(true);
    verbose.emit({ type: "thinking_start" });
    expect(write).toHaveBeenCalledWith("[thinking] ");

    write.mockClear();

    const quiet = new CliTransport(false);
    quiet.emit({ type: "thinking_start" });
    expect(write).toHaveBeenCalledWith("[kota] Thinking...\n");

    write.mockRestore();
  });

  it("formats cost events", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = new CliTransport();
    t.emit({ type: "cost", summary: "$0.05", budgetPercent: 42 });
    expect(error).toHaveBeenCalledWith("[kota] $0.05 — context: 42%");
    error.mockRestore();
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
