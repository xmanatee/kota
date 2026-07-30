import { beforeEach, describe, expect, it, vi } from "vitest";
import { deferred, mockAssess, mockExecuteTool, mockGetToolEffect, mockTruncate, readEffect, releaseTool, runOptions, safeAssessment, startTracker, toolBlock } from "./runner-test-support.js";
import { executeToolCalls } from "./tool-runner.js";
import { getToolTelemetry, resetToolTelemetry } from "./tool-telemetry.js";

describe("executeToolCalls scheduling and results", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetToolTelemetry();
    mockTruncate.mockImplementation((text: string) => text);
    mockAssess.mockReturnValue(safeAssessment);
    mockGetToolEffect.mockReturnValue(readEffect);
  });
  it("uses MCP readOnlyHint true for parallel batches and fails closed otherwise", async () => {
    mockGetToolEffect.mockImplementation((name: string) =>
      name === "local_read" ? readEffect : undefined,
    );
    const tracker = startTracker();
    const deferreds = new Map<string, { resolve: () => void }>();
    const startDeferredTool = async (name: string) => {
      tracker.markStarted(name);
      const pending = deferred();
      deferreds.set(name, pending);
      await pending.promise;
      return { content: `result:${name}` };
    };
    mockExecuteTool.mockImplementation((name: string) => startDeferredTool(name));
    const mcpManager = {
      isMcpTool: vi.fn((name: string) => name.startsWith("mcp__")),
		getTools: vi.fn(() => [
			"read",
			"write",
			"missing_metadata",
			"read_after",
		].map((name) => ({
			name: `mcp__server__${name}`,
			description: "test",
			input_schema: { type: "object" as const, properties: {} },
		}))),
      isToolReadOnly: vi.fn((name: string) =>
        name === "mcp__server__read" || name === "mcp__server__read_after",
      ),
      executeTool: vi.fn((name: string) => startDeferredTool(name)),
    };

    const pending = executeToolCalls(
      [
        toolBlock("local_read", {}, "t1"),
        toolBlock("mcp__server__read", {}, "t2"),
        toolBlock("mcp__server__write", {}, "t3"),
        toolBlock("mcp__server__missing_metadata", {}, "t4"),
        toolBlock("mcp__server__read_after", {}, "t5"),
      ],
      runOptions({ mcpManager: mcpManager as never }),
    );

    expect(tracker.started).toEqual(["local_read", "mcp__server__read"]);
    releaseTool(deferreds, "mcp__server__read");
    releaseTool(deferreds, "local_read");
    await tracker.waitForStart("mcp__server__write");
    expect(tracker.started).toEqual(["local_read", "mcp__server__read", "mcp__server__write"]);

    releaseTool(deferreds, "mcp__server__write");
    await tracker.waitForStart("mcp__server__missing_metadata");
    expect(tracker.started).toEqual([
      "local_read",
      "mcp__server__read",
      "mcp__server__write",
      "mcp__server__missing_metadata",
    ]);

    releaseTool(deferreds, "mcp__server__missing_metadata");
    await tracker.waitForStart("mcp__server__read_after");
    expect(tracker.started).toEqual([
      "local_read",
      "mcp__server__read",
      "mcp__server__write",
      "mcp__server__missing_metadata",
      "mcp__server__read_after",
    ]);

    releaseTool(deferreds, "mcp__server__read_after");
    const results = await pending;
    expect(results.map((result) => result.tool_use_id)).toEqual(["t1", "t2", "t3", "t4", "t5"]);
    expect(mcpManager.isToolReadOnly).toHaveBeenCalledWith("mcp__server__write");
    expect(mcpManager.isToolReadOnly).toHaveBeenCalledWith("mcp__server__missing_metadata");
  });

  it("routes MCP tools through mcpManager", async () => {
    const imageBlock = {
      type: "image" as const,
      source: { type: "base64" as const, media_type: "image/png", data: "abc" },
    };
    const mcpManager = {
      isMcpTool: vi.fn((name: string) => name.startsWith("mcp__")),
		getTools: vi.fn(() => [{
			name: "mcp__server__tool",
			description: "test",
			input_schema: { type: "object" as const, properties: {} },
		}]),
      executeTool: vi.fn().mockResolvedValue({
        content: "mcp result",
        blocks: [{ type: "text", text: "mcp result" }, imageBlock],
        structuredContent: { answer: 42 },
        _meta: { cache: "hit" },
        is_error: true,
      }),
    };
    const results = await executeToolCalls(
      [toolBlock("mcp__server__tool", { q: "test" })],
      runOptions({ mcpManager: mcpManager as never }),
    );
    expect(mcpManager.executeTool).toHaveBeenCalledWith(
      "mcp__server__tool",
      { q: "test" },
    );
    expect(mockExecuteTool).not.toHaveBeenCalled();
    expect(results[0].content).toBe("mcp result");
    expect(results[0].blocks).toEqual([{ type: "text", text: "mcp result" }, imageBlock]);
    expect(results[0].structuredContent).toEqual({ answer: 42 });
    expect(results[0]._meta).toEqual({ cache: "hit" });
    expect(results[0].is_error).toBe(true);
    expect(getToolTelemetry().getCallRecords()).toEqual([
      expect.objectContaining({
        toolUseId: "t1",
        tool: "mcp__server__tool",
        success: false,
        resultContentKind: "mixed",
        incomplete: false,
      }),
    ]);
  });

  it("passes MCP input resolver context to MCP tool execution when available", async () => {
    const mcpInputResolver = vi.fn();
    const mcpManager = {
      isMcpTool: vi.fn((name: string) => name.startsWith("mcp__")),
		getTools: vi.fn(() => [{
			name: "mcp__server__tool",
			description: "test",
			input_schema: { type: "object" as const, properties: {} },
		}]),
      executeTool: vi.fn().mockResolvedValue({ content: "mcp result" }),
    };
    await executeToolCalls(
      [toolBlock("mcp__server__tool", { q: "test" })],
      runOptions({
        mcpManager: mcpManager as never,
        mcpInputResolver,
      }),
    );

    expect(mcpManager.executeTool).toHaveBeenCalledWith(
      "mcp__server__tool",
      { q: "test" },
      { inputResolver: mcpInputResolver },
    );
  });

  it("passes abort signal context to MCP tool execution when available", async () => {
    const controller = new AbortController();
    const mcpManager = {
      isMcpTool: vi.fn((name: string) => name.startsWith("mcp__")),
		getTools: vi.fn(() => [{
			name: "mcp__server__tool",
			description: "test",
			input_schema: { type: "object" as const, properties: {} },
		}]),
      executeTool: vi.fn().mockResolvedValue({ content: "mcp result" }),
    };
    await executeToolCalls(
      [toolBlock("mcp__server__tool", { q: "test" })],
      runOptions({
        mcpManager: mcpManager as never,
        signal: controller.signal,
      }),
    );

    expect(mcpManager.executeTool).toHaveBeenCalledWith(
      "mcp__server__tool",
      { q: "test" },
      { signal: controller.signal },
    );
  });

  it("uses executeTool for non-MCP tools when mcpManager present", async () => {
    mockExecuteTool.mockResolvedValue({ content: "local result" });
    const mcpManager = {
      isMcpTool: vi.fn(() => false),
      executeTool: vi.fn(),
    };
    await executeToolCalls(
      [toolBlock("shell", { command: "ls" })],
      runOptions({ mcpManager: mcpManager as never }),
    );
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "shell",
      { command: "ls" },
      expect.objectContaining({
        approvalQueue: expect.any(Object),
        toolUseId: "t1",
      }),
    );
    expect(mcpManager.executeTool).not.toHaveBeenCalled();
  });

  it("passes through error for non-retryable tools (no middleware)", async () => {
    mockExecuteTool.mockResolvedValue({
      content: "permanent error",
      is_error: true,
    });
    const results = await executeToolCalls(
      [toolBlock("shell", { command: "bad" })],
      runOptions(),
    );
    expect(results[0].content).toBe("permanent error");
    expect(results[0].is_error).toBe(true);
  });

  it("records bounded per-call telemetry for local failures and oversized results", async () => {
    const oversized = "x".repeat(120);
    mockExecuteTool
      .mockResolvedValueOnce({ content: oversized })
      .mockResolvedValueOnce({ content: "boom", is_error: true });

    await executeToolCalls(
      [
        toolBlock("file_read", { path: "/large.txt" }, "local-1"),
        toolBlock("shell", { command: "exit 1" }, "local-2"),
      ],
      runOptions({ resultLimit: 50 }),
    );

    const calls = getToolTelemetry().getCallRecords();
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      toolUseId: "local-1",
      tool: "file_read",
      inputBytes: Buffer.byteLength(JSON.stringify({ path: "/large.txt" }), "utf-8"),
      resultBytes: Buffer.byteLength(oversized, "utf-8"),
      resultContentKind: "text",
      success: true,
      truncated: true,
      incomplete: false,
    });
    expect(calls[1]).toMatchObject({
      toolUseId: "local-2",
      tool: "shell",
      resultBytes: Buffer.byteLength("boom", "utf-8"),
      resultContentKind: "text",
      success: false,
      truncated: false,
      incomplete: false,
    });
    expect(JSON.stringify(calls)).not.toContain(oversized.slice(0, 20));
    expect(getToolTelemetry().getToolStats("shell")).toMatchObject({ calls: 1, failures: 1 });
  });

  it("truncates plain text results to resultLimit", async () => {
    mockExecuteTool.mockResolvedValue({ content: "long content" });
    mockTruncate.mockReturnValue("truncated");
    const results = await executeToolCalls(
      [toolBlock("file_read")],
      runOptions({ resultLimit: 5000 }),
    );
    expect(mockTruncate).toHaveBeenCalledWith("long content", 5000);
    expect(results[0].content).toBe("truncated");
  });

  it("truncates text blocks in rich results but preserves image blocks", async () => {
    const imageBlock = {
      type: "image" as const,
      source: { type: "base64" as const, media_type: "image/png", data: "abc" },
    };
    mockExecuteTool.mockResolvedValue({
      content: "summary",
      blocks: [{ type: "text", text: "long text" }, imageBlock],
    });
    mockTruncate.mockImplementation((text: string) => `T:${text}`);
    const results = await executeToolCalls(
      [toolBlock("file_read")],
      runOptions({ resultLimit: 5000 }),
    );
    expect(results[0].blocks).toHaveLength(2);
    expect(results[0].blocks![0]).toEqual({ type: "text", text: "T:long text" });
    expect(results[0].blocks![1]).toEqual(imageBlock);
  });
});
