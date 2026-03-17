import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  executeToolCalls,
  FailureTracker,
  type ToolResultEntry,
} from "./tool-runner.js";

vi.mock("./tools/index.js", () => ({
  executeTool: vi.fn(),
}));
vi.mock("./context.js", () => ({
  truncateToolResult: vi.fn((text: string) => text),
}));

import { truncateToolResult } from "./context.js";
import { executeTool } from "./tools/index.js";

const mockExecuteTool = vi.mocked(executeTool);
const mockTruncate = vi.mocked(truncateToolResult);

function toolBlock(
  name: string,
  input: Record<string, unknown> = {},
  id = "t1",
) {
  return { type: "tool_use" as const, id, name, input };
}

function ok(content = "done"): ToolResultEntry[] {
  return [{ tool_use_id: "t1", content }];
}

function err(content = "error"): ToolResultEntry[] {
  return [{ tool_use_id: "t1", content, is_error: true }];
}

describe("FailureTracker", () => {
  it("returns continue on success", () => {
    const tracker = new FailureTracker();
    expect(tracker.record(ok())).toBe("continue");
  });

  it("returns continue on first few failures", () => {
    const tracker = new FailureTracker();
    expect(tracker.record(err("a"))).toBe("continue");
    expect(tracker.record(err("b"))).toBe("continue");
  });

  it("resets on success after failures", () => {
    const tracker = new FailureTracker();
    tracker.record(err("a"));
    tracker.record(err("b"));
    tracker.record(ok());
    // After reset, 4 more diverse failures should still be "continue"
    for (let i = 0; i < 4; i++) {
      expect(tracker.record(err(`new-${i}`))).toBe("continue");
    }
  });

  it("circuit breaks after 3 identical failures", () => {
    const tracker = new FailureTracker();
    expect(tracker.record(err("same error"))).toBe("continue");
    expect(tracker.record(err("same error"))).toBe("continue");
    expect(tracker.record(err("same error"))).toBe("circuit_break");
  });

  it("does not circuit break if errors differ", () => {
    const tracker = new FailureTracker();
    tracker.record(err("error A"));
    tracker.record(err("error B"));
    tracker.record(err("error C"));
    // 3 failures but all different — no circuit break
    expect(tracker.record(err("error D"))).toBe("continue");
  });

  it("injects guidance after 5 diverse consecutive failures", () => {
    const tracker = new FailureTracker();
    expect(tracker.record(err("a"))).toBe("continue");
    expect(tracker.record(err("b"))).toBe("continue");
    expect(tracker.record(err("c"))).toBe("continue");
    expect(tracker.record(err("d"))).toBe("continue");
    expect(tracker.record(err("e"))).toBe("inject_guidance");
  });

  it("resets consecutive count after guidance injection", () => {
    const tracker = new FailureTracker();
    for (let i = 0; i < 5; i++) tracker.record(err(`err-${i}`));
    // After inject_guidance, counter resets
    expect(tracker.record(err("f"))).toBe("continue");
  });

  it("handles mixed success/failure results — any error counts as failure", () => {
    const tracker = new FailureTracker();
    const mixed: ToolResultEntry[] = [
      { tool_use_id: "t1", content: "ok" },
      { tool_use_id: "t2", content: "bad", is_error: true },
    ];
    expect(tracker.record(mixed)).toBe("continue"); // has errors, so failure
  });

  it("handles empty results as success (no errors)", () => {
    const tracker = new FailureTracker();
    tracker.record(err("a"));
    tracker.record(err("b"));
    // Empty results = no errors = success = reset
    tracker.record([]);
    expect(tracker.record(err("c"))).toBe("continue");
  });

  it("getMessage returns correct strings", () => {
    expect(FailureTracker.getMessage("circuit_break")).toContain("3 times");
    expect(FailureTracker.getMessage("inject_guidance")).toContain(
      "5 consecutive",
    );
    expect(FailureTracker.getMessage("continue")).toBe("");
  });

  it("identical signature uses concatenated error content", () => {
    const tracker = new FailureTracker();
    const twoErrors: ToolResultEntry[] = [
      { tool_use_id: "t1", content: "err1", is_error: true },
      { tool_use_id: "t2", content: "err2", is_error: true },
    ];
    tracker.record(twoErrors);
    tracker.record(twoErrors);
    // Third identical batch triggers circuit break
    expect(tracker.record(twoErrors)).toBe("circuit_break");
  });
});

describe("executeToolCalls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTruncate.mockImplementation((text: string) => text);
  });

  it("routes tool call to executeTool and returns result", async () => {
    mockExecuteTool.mockResolvedValue({ content: "file contents" });
    const results = await executeToolCalls(
      [toolBlock("file_read", { path: "/a.txt" })],
      50000,
      false,
    );
    expect(mockExecuteTool).toHaveBeenCalledWith("file_read", {
      path: "/a.txt",
    });
    expect(results).toHaveLength(1);
    expect(results[0].tool_use_id).toBe("t1");
    expect(results[0].content).toBe("file contents");
    expect(results[0].is_error).toBeUndefined();
  });

  it("executes multiple tools in parallel", async () => {
    mockExecuteTool.mockResolvedValue({ content: "ok" });
    const blocks = [
      toolBlock("grep", { pattern: "TODO" }, "t1"),
      toolBlock("glob", { pattern: "*.ts" }, "t2"),
    ];
    const results = await executeToolCalls(blocks, 50000, false);
    expect(results).toHaveLength(2);
    expect(results[0].tool_use_id).toBe("t1");
    expect(results[1].tool_use_id).toBe("t2");
    expect(mockExecuteTool).toHaveBeenCalledTimes(2);
  });

  it("routes MCP tools through mcpManager", async () => {
    const mcpManager = {
      isMcpTool: vi.fn((name: string) => name.startsWith("mcp__")),
      executeTool: vi.fn().mockResolvedValue({ content: "mcp result" }),
    };
    const results = await executeToolCalls(
      [toolBlock("mcp__server__tool", { q: "test" })],
      50000,
      false,
      mcpManager as any,
    );
    expect(mcpManager.executeTool).toHaveBeenCalledWith(
      "mcp__server__tool",
      { q: "test" },
    );
    expect(mockExecuteTool).not.toHaveBeenCalled();
    expect(results[0].content).toBe("mcp result");
  });

  it("uses executeTool for non-MCP tools when mcpManager present", async () => {
    mockExecuteTool.mockResolvedValue({ content: "local result" });
    const mcpManager = {
      isMcpTool: vi.fn(() => false),
      executeTool: vi.fn(),
    };
    await executeToolCalls(
      [toolBlock("shell", { command: "ls" })],
      50000,
      false,
      mcpManager as any,
    );
    expect(mockExecuteTool).toHaveBeenCalledWith("shell", { command: "ls" });
    expect(mcpManager.executeTool).not.toHaveBeenCalled();
  });

  it("passes through error for non-retryable tools (no middleware)", async () => {
    mockExecuteTool.mockResolvedValue({
      content: "permanent error",
      is_error: true,
    });
    const results = await executeToolCalls(
      [toolBlock("shell", { command: "bad" })],
      50000,
      false,
    );
    expect(results[0].content).toBe("permanent error");
    expect(results[0].is_error).toBe(true);
  });

  it("truncates plain text results to resultLimit", async () => {
    mockExecuteTool.mockResolvedValue({ content: "long content" });
    mockTruncate.mockReturnValue("truncated");
    const results = await executeToolCalls(
      [toolBlock("file_read")],
      5000,
      false,
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
      5000,
      false,
    );
    expect(results[0].blocks).toHaveLength(2);
    expect(results[0].blocks![0]).toEqual({ type: "text", text: "T:long text" });
    expect(results[0].blocks![1]).toEqual(imageBlock);
  });
});
