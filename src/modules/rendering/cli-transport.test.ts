import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliTransport } from "./cli-transport.js";

describe("CliTransport", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  function stderrChunks(): string[] {
    return stderrSpy.mock.calls.map((c: unknown[]) => String(c[0]));
  }

  it("routes streaming text events to stdout without a trailing newline", () => {
    const t = new CliTransport();
    t.emit({ type: "text", content: "hello" });
    expect(stdoutSpy).toHaveBeenCalledWith("hello");
  });

  it("routes status events to stderr as a rendered line", () => {
    const t = new CliTransport();
    t.emit({ type: "status", message: "[kota] test" });
    expect(stderrChunks()).toContain("[kota] test\n");
  });

  it("routes streaming progress events to stderr raw", () => {
    const t = new CliTransport();
    t.emit({ type: "progress", content: "sub-agent output" });
    expect(stderrSpy).toHaveBeenCalledWith("sub-agent output");
  });

  it("shows thinking in verbose mode", () => {
    const t = new CliTransport(true);
    t.emit({ type: "thinking", content: "reasoning..." });
    expect(stderrSpy).toHaveBeenCalledWith("reasoning...");
  });

  it("suppresses thinking in non-verbose mode", () => {
    const t = new CliTransport(false);
    t.emit({ type: "thinking", content: "reasoning..." });
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("emits thinking_start differently based on verbose", () => {
    const verbose = new CliTransport(true);
    verbose.emit({ type: "thinking_start" });
    expect(stderrSpy).toHaveBeenCalledWith("[thinking] ");

    stderrSpy.mockClear();

    const quiet = new CliTransport(false);
    quiet.emit({ type: "thinking_start" });
    expect(stderrSpy).toHaveBeenCalledWith("[kota] Thinking...\n");
  });

  it("formats cost events with per-turn and total when provided", () => {
    const t = new CliTransport();
    t.emit({ type: "cost", summary: "Turn 3 — $0.087 (50.0K in, 5.0K out)", budgetPercent: 42, turn: 3, turnCostUsd: 0.024, totalCostUsd: 0.087 });
    const out = stderrChunks().join("");
    expect(out).toContain("[kota] Turn 3 — $0.0240 this turn · $0.0870 total — context: 42%");
  });

  it("formats cost events with legacy summary fallback", () => {
    const t = new CliTransport();
    t.emit({ type: "cost", summary: "$0.05", budgetPercent: 42 });
    const out = stderrChunks().join("");
    expect(out).toContain("[kota] $0.05 — context: 42%");
  });

  it("suppresses cost events when showCost is false", () => {
    const t = new CliTransport(false, false);
    t.emit({ type: "cost", summary: "$0.05", budgetPercent: 42, turn: 1, turnCostUsd: 0.05, totalCostUsd: 0.05 });
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
