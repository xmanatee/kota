import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  executeToolCalls,
  extractApprovalContext,
  FailureTracker,
  type ToolResultEntry,
} from "./tool-runner.js";

vi.mock("./index.js", () => ({
  executeTool: vi.fn(),
}));
vi.mock("#core/loop/context.js", () => ({
  truncateToolResult: vi.fn((text: string) => text),
}));
vi.mock("./guardrails.js", () => ({
  assess: vi.fn(),
}));
vi.mock("#root/confirm.js", () => ({
  confirmAction: vi.fn(),
}));
const tryEmitMock = vi.hoisted(() => vi.fn());
vi.mock("#core/events/event-bus.js", () => ({
  tryEmit: tryEmitMock,
}));
vi.mock("#core/daemon/approval-queue.js", () => ({
  getApprovalQueue: vi.fn(() => ({
    enqueue: vi.fn(() => ({ id: "abc123" })),
  })),
}));
vi.mock("#root/secrets.js", () => ({
  getSecretStore: vi.fn(() => null),
}));

import { getApprovalQueue } from "#core/daemon/approval-queue.js";
import { truncateToolResult } from "#core/loop/context.js";
import { confirmAction } from "#root/confirm.js";
import { assess } from "./guardrails.js";
import { executeTool } from "./index.js";

const mockExecuteTool = vi.mocked(executeTool);
const mockTruncate = vi.mocked(truncateToolResult);
const mockAssess = vi.mocked(assess);
const mockConfirmAction = vi.mocked(confirmAction);
const mockGetApprovalQueue = vi.mocked(getApprovalQueue);

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

const dangerousAssessment = {
  tool: "shell",
  risk: "dangerous" as const,
  policy: "confirm" as const,
  reason: "destructive command pattern detected",
};

const confirmConfig = {
  policies: { safe: "allow" as const, moderate: "allow" as const, dangerous: "confirm" as const },
};

describe("guardrails confirm gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTruncate.mockImplementation((text: string) => text);
    mockGetApprovalQueue.mockReturnValue({ enqueue: vi.fn(() => ({ id: "abc123" })) } as any);
  });

  it("blocks a destructive tool call when user rejects confirmation", async () => {
    mockAssess.mockReturnValue(dangerousAssessment);
    mockConfirmAction.mockResolvedValue(false);

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "git reset --hard HEAD~1" })],
      50000,
      false,
      undefined,
      undefined,
      confirmConfig,
    );

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("requires confirmation");
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("executes a destructive tool when user approves confirmation", async () => {
    mockAssess.mockReturnValue(dangerousAssessment);
    mockConfirmAction.mockResolvedValue(true);
    mockExecuteTool.mockResolvedValue({ content: "reset done" });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "git reset --hard HEAD~1" })],
      50000,
      false,
      undefined,
      undefined,
      confirmConfig,
    );

    expect(results[0].is_error).toBeUndefined();
    expect(results[0].content).toBe("reset done");
    expect(mockExecuteTool).toHaveBeenCalledWith("shell", { command: "git reset --hard HEAD~1" });
  });

  it("blocks a tool call when policy is deny", async () => {
    mockAssess.mockReturnValue({ ...dangerousAssessment, policy: "deny" as const });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "rm -rf /" })],
      50000,
      false,
      undefined,
      undefined,
      { policies: { safe: "allow", moderate: "allow", dangerous: "deny" } },
    );

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("Blocked by guardrails");
    expect(mockExecuteTool).not.toHaveBeenCalled();
    expect(mockConfirmAction).not.toHaveBeenCalled();
  });

  it("queues a tool call when policy is queue", async () => {
    const mockEnqueue = vi.fn(() => ({ id: "q1" }));
    mockGetApprovalQueue.mockReturnValue({ enqueue: mockEnqueue } as any);
    mockAssess.mockReturnValue({ ...dangerousAssessment, policy: "queue" as const });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "rm -rf /tmp/old" })],
      50000,
      false,
      undefined,
      undefined,
      { policies: { safe: "allow", moderate: "allow", dangerous: "queue" } },
      "session-1",
    );

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("Queued for approval");
    expect(results[0].content).toContain("q1");
    expect(mockExecuteTool).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledWith(
      "shell",
      { command: "rm -rf /tmp/old" },
      "dangerous",
      "destructive command pattern detected",
      "session-1",
      undefined,
      undefined,
      undefined,
    );
  });

  it("emits guardrail event to transport", async () => {
    mockAssess.mockReturnValue({ ...dangerousAssessment, policy: "deny" as const });
    const transport = { emit: vi.fn() };

    await executeToolCalls(
      [toolBlock("shell", { command: "rm -rf /" })],
      50000,
      false,
      undefined,
      transport as any,
      { policies: { safe: "allow", moderate: "allow", dangerous: "deny" } },
    );

    expect(transport.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "guardrail",
        tool: "shell",
        risk: "dangerous",
        policy: "deny",
      }),
    );
  });

  it("passes conversation context to enqueue when messages provided", async () => {
    const mockEnqueue = vi.fn(() => ({ id: "q2" }));
    mockGetApprovalQueue.mockReturnValue({ enqueue: mockEnqueue } as any);
    mockAssess.mockReturnValue({ ...dangerousAssessment, policy: "queue" as const });

    const messages = [
      { role: "user" as const, content: "Please delete old temp files" },
      { role: "assistant" as const, content: "I will delete files in /tmp/old to free space" },
    ];

    await executeToolCalls(
      [toolBlock("shell", { command: "rm -rf /tmp/old" })],
      50000,
      false,
      undefined,
      undefined,
      { policies: { safe: "allow", moderate: "allow", dangerous: "queue" } },
      "session-2",
      messages,
    );

    const enqueueArgs: unknown[] = mockEnqueue.mock.calls[0] as unknown[];
    const contextArg = enqueueArgs[7];
    expect(typeof contextArg).toBe("string");
    expect(contextArg as string).toContain("Please delete old temp files");
    expect(contextArg as string).toContain("delete files in /tmp/old");
  });

  it("emits guardrail.assessed event with assessment and sessionId", async () => {
    mockAssess.mockReturnValue({ ...dangerousAssessment, policy: "deny" as const });

    await executeToolCalls(
      [toolBlock("shell", { command: "rm -rf /" })],
      50000,
      false,
      undefined,
      undefined,
      { policies: { safe: "allow", moderate: "allow", dangerous: "deny" } },
      "session-42",
    );

    expect(tryEmitMock).toHaveBeenCalledWith(
      "guardrail.assessed",
      expect.objectContaining({ tool: "shell", risk: "dangerous", policy: "deny", session: "session-42" }),
    );
  });
});

describe("extractApprovalContext", () => {
  it("returns undefined for empty messages", () => {
    expect(extractApprovalContext([])).toBeUndefined();
  });

  it("returns undefined when all messages have no text", () => {
    const messages = [
      {
        role: "user" as const,
        content: [{ type: "tool_result" as const, tool_use_id: "x", content: "result" }],
      },
    ];
    expect(extractApprovalContext(messages)).toBeUndefined();
  });

  it("extracts text from string content messages", () => {
    const messages = [
      { role: "user" as const, content: "What is the weather?" },
      { role: "assistant" as const, content: "I will check the weather for you." },
    ];
    const ctx = extractApprovalContext(messages);
    expect(ctx).toContain("User: What is the weather?");
    expect(ctx).toContain("Assistant: I will check the weather for you.");
  });

  it("extracts text blocks from array content", () => {
    const messages = [
      {
        role: "assistant" as const,
        content: [
          { type: "text" as const, text: "Processing your request" },
          { type: "tool_use" as const, id: "t1", name: "shell", input: {} },
        ],
      },
    ];
    const ctx = extractApprovalContext(messages);
    expect(ctx).toContain("Processing your request");
  });

  it("respects turns limit", () => {
    const messages = [
      { role: "user" as const, content: "message 1" },
      { role: "assistant" as const, content: "response 1" },
      { role: "user" as const, content: "message 2" },
      { role: "assistant" as const, content: "response 2" },
      { role: "user" as const, content: "message 3" },
    ];
    const ctx = extractApprovalContext(messages, 2);
    expect(ctx).not.toContain("message 1");
    expect(ctx).not.toContain("response 1");
    expect(ctx).toContain("response 2");
    expect(ctx).toContain("message 3");
  });

  it("truncates output at maxChars", () => {
    const longText = "x".repeat(3000);
    const messages = [{ role: "assistant" as const, content: longText }];
    const ctx = extractApprovalContext(messages, 3, 100);
    expect(ctx).toBeDefined();
    expect(ctx!.length).toBeLessThanOrEqual(101); // 100 chars + ellipsis
    expect(ctx).toMatch(/…$/);
  });
});
