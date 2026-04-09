import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleLoader } from "./module-loader.js";
import filesystemModule from "./modules/filesystem/index.js";
import { getToolTelemetry, resetToolTelemetry, ToolTelemetry } from "./tool-telemetry.js";
import { clearCustomTools } from "./tools/index.js";

describe("ToolTelemetry", () => {
  it("records a successful tool call", () => {
    const t = new ToolTelemetry();
    t.record("file_read", 42, true);
    const stats = t.getToolStats("file_read");
    expect(stats).toBeDefined();
    expect(stats!.calls).toBe(1);
    expect(stats!.successes).toBe(1);
    expect(stats!.failures).toBe(0);
    expect(stats!.totalMs).toBe(42);
    expect(stats!.minMs).toBe(42);
    expect(stats!.maxMs).toBe(42);
  });

  it("records a failed tool call with error", () => {
    const t = new ToolTelemetry();
    t.record("web_fetch", 1500, false, "ECONNRESET");
    const stats = t.getToolStats("web_fetch");
    expect(stats!.failures).toBe(1);
    expect(stats!.successes).toBe(0);
    expect(stats!.lastError).toBe("ECONNRESET");
  });

  it("aggregates multiple calls to the same tool", () => {
    const t = new ToolTelemetry();
    t.record("shell", 100, true);
    t.record("shell", 200, true);
    t.record("shell", 300, false, "timeout");
    const stats = t.getToolStats("shell");
    expect(stats!.calls).toBe(3);
    expect(stats!.successes).toBe(2);
    expect(stats!.failures).toBe(1);
    expect(stats!.totalMs).toBe(600);
    expect(stats!.minMs).toBe(100);
    expect(stats!.maxMs).toBe(300);
    expect(stats!.lastError).toBe("timeout");
  });

  it("tracks multiple tools independently", () => {
    const t = new ToolTelemetry();
    t.record("file_read", 10, true);
    t.record("grep", 50, true);
    t.record("file_read", 15, true);
    expect(t.getToolStats("file_read")!.calls).toBe(2);
    expect(t.getToolStats("grep")!.calls).toBe(1);
    expect(t.getStats().size).toBe(2);
  });

  it("getTotalCalls sums across all tools", () => {
    const t = new ToolTelemetry();
    t.record("a", 10, true);
    t.record("b", 20, true);
    t.record("a", 30, false);
    expect(t.getTotalCalls()).toBe(3);
  });

  it("getTotalFailures sums failures across all tools", () => {
    const t = new ToolTelemetry();
    t.record("a", 10, true);
    t.record("b", 20, false);
    t.record("a", 30, false);
    expect(t.getTotalFailures()).toBe(2);
  });

  it("returns undefined for unrecorded tool", () => {
    const t = new ToolTelemetry();
    expect(t.getToolStats("nonexistent")).toBeUndefined();
  });

  it("reset clears all data", () => {
    const t = new ToolTelemetry();
    t.record("shell", 100, true);
    t.record("grep", 50, false);
    t.reset();
    expect(t.getStats().size).toBe(0);
    expect(t.getTotalCalls()).toBe(0);
    expect(t.getSummary()).toBe("");
  });

  describe("getSummary", () => {
    it("returns empty string with no data", () => {
      const t = new ToolTelemetry();
      expect(t.getSummary()).toBe("");
    });

    it("formats summary for successful calls only", () => {
      const t = new ToolTelemetry();
      t.record("file_read", 20, true);
      t.record("grep", 30, true);
      const summary = t.getSummary();
      expect(summary).toContain("2 tool calls");
      expect(summary).toContain("2 ok");
      expect(summary).toContain("avg 25ms");
      expect(summary).not.toContain("failed");
    });

    it("includes failure breakdown when tools fail", () => {
      const t = new ToolTelemetry();
      t.record("file_read", 20, true);
      t.record("web_fetch", 1000, false);
      t.record("web_fetch", 800, true);
      const summary = t.getSummary();
      expect(summary).toContain("3 tool calls");
      expect(summary).toContain("2 ok");
      expect(summary).toContain("1 failed");
      expect(summary).toContain("web_fetch: 1/2 fail");
    });
  });

  describe("getDetailedSummary", () => {
    it("returns message for no data", () => {
      const t = new ToolTelemetry();
      expect(t.getDetailedSummary()).toBe("No tool calls recorded.");
    });

    it("sorts by call count descending", () => {
      const t = new ToolTelemetry();
      t.record("grep", 10, true);
      t.record("shell", 20, true);
      t.record("shell", 30, true);
      t.record("shell", 40, true);
      const lines = t.getDetailedSummary().split("\n");
      expect(lines[0]).toMatch(/^shell:/);
      expect(lines[1]).toMatch(/^grep:/);
    });

    it("includes range for multi-call tools", () => {
      const t = new ToolTelemetry();
      t.record("shell", 100, true);
      t.record("shell", 500, true);
      const detail = t.getDetailedSummary();
      expect(detail).toContain("(100-500ms)");
    });

    it("includes last error for failed tools", () => {
      const t = new ToolTelemetry();
      t.record("web_fetch", 1000, false, "Connection refused");
      const detail = t.getDetailedSummary();
      expect(detail).toContain("last error: Connection refused");
    });
  });

  it("truncates long error messages to 200 chars", () => {
    const t = new ToolTelemetry();
    const longError = "x".repeat(500);
    t.record("shell", 100, false, longError);
    expect(t.getToolStats("shell")!.lastError!.length).toBe(200);
  });
});

describe("Integration: telemetry populated via executeToolCalls", () => {
  beforeAll(async () => {
    const loader = new ModuleLoader({});
    await loader.loadAll([filesystemModule]);
  });

  afterAll(() => {
    clearCustomTools();
  });

  beforeEach(() => {
    resetToolTelemetry();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    resetToolTelemetry();
    vi.restoreAllMocks();
  });

  it("records timing and success for real tool execution", async () => {
    // Import executeToolCalls — it uses the real tool runner which calls getToolTelemetry()
    const { executeToolCalls } = await import("./tool-runner.js");
    const { BufferTransport } = await import("./transport.js");
    const transport = new BufferTransport();

    // Use a real tool (file_read with non-existent file → error)
    await executeToolCalls(
      [{ type: "tool_use", id: "t1", name: "file_read", input: { path: "/nonexistent/path.txt" } }],
      5000,
      true,
      undefined,
      transport,
    );

    const telemetry = getToolTelemetry();
    expect(telemetry.getTotalCalls()).toBe(1);
    const stats = telemetry.getToolStats("file_read");
    expect(stats).toBeDefined();
    expect(stats!.calls).toBe(1);
    expect(stats!.failures).toBe(1);
    expect(stats!.totalMs).toBeGreaterThanOrEqual(0);

    // Should emit tool_metric event
    const metrics = transport.events.filter((e) => e.type === "tool_metric");
    expect(metrics).toHaveLength(1);
    const m = metrics[0] as { type: "tool_metric"; tool: string; durationMs: number; success: boolean };
    expect(m.tool).toBe("file_read");
    expect(m.success).toBe(false);
    expect(m.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records success for working tool", async () => {
    const { executeToolCalls } = await import("./tool-runner.js");
    const { BufferTransport } = await import("./transport.js");
    const transport = new BufferTransport();
    const { writeFileSync, unlinkSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const tmpFile = join(tmpdir(), `telemetry-test-${Date.now()}.txt`);
    writeFileSync(tmpFile, "hello");

    try {
      await executeToolCalls(
        [{ type: "tool_use", id: "t2", name: "file_read", input: { path: tmpFile } }],
        5000,
        false,
        undefined,
        transport,
      );

      const stats = getToolTelemetry().getToolStats("file_read");
      expect(stats!.successes).toBe(1);
      expect(stats!.failures).toBe(0);
    } finally {
      unlinkSync(tmpFile);
    }
  });
});

describe("toToolCallSummary", () => {
  it("returns undefined when no calls recorded", () => {
    const t = new ToolTelemetry();
    expect(t.toToolCallSummary()).toBeUndefined();
  });

  it("returns sorted entries with count and totalMs", () => {
    const t = new ToolTelemetry();
    t.record("Read", 100, true);
    t.record("Read", 200, true);
    t.record("Bash", 500, true);
    t.record("Bash", 300, false);
    t.record("Bash", 200, true);
    t.record("Edit", 150, true);
    const summary = t.toToolCallSummary();
    expect(summary).toBeDefined();
    expect(summary![0]).toEqual({ tool: "Bash", count: 3, totalMs: 1000 });
    expect(summary![1]).toEqual({ tool: "Read", count: 2, totalMs: 300 });
    expect(summary![2]).toEqual({ tool: "Edit", count: 1, totalMs: 150 });
  });

  it("builds summary correctly from mock session transcript tracking", () => {
    const t = new ToolTelemetry();
    // Simulate what makeToolTelemetryTracker does: record calls from assistant + user turn messages
    t.record("Bash", 42000, true);
    t.record("Read", 800, true);
    t.record("Read", 300, true);
    t.record("Edit", 1200, true);
    t.record("Bash", 5000, false, "timeout");

    const summary = t.toToolCallSummary()!;
    expect(summary).toHaveLength(3);
    // Bash called twice
    const bash = summary.find((s) => s.tool === "Bash");
    expect(bash).toEqual({ tool: "Bash", count: 2, totalMs: 47000 });
    // Read called twice
    const read = summary.find((s) => s.tool === "Read");
    expect(read).toEqual({ tool: "Read", count: 2, totalMs: 1100 });
    // Edit called once
    const edit = summary.find((s) => s.tool === "Edit");
    expect(edit).toEqual({ tool: "Edit", count: 1, totalMs: 1200 });
  });
});

describe("Singleton management", () => {
  afterEach(() => {
    resetToolTelemetry();
  });

  it("getToolTelemetry returns the same instance", () => {
    const a = getToolTelemetry();
    const b = getToolTelemetry();
    expect(a).toBe(b);
  });

  it("resetToolTelemetry creates a fresh instance", () => {
    const a = getToolTelemetry();
    a.record("test", 10, true);
    resetToolTelemetry();
    const b = getToolTelemetry();
    expect(b).not.toBe(a);
    expect(b.getTotalCalls()).toBe(0);
  });
});
