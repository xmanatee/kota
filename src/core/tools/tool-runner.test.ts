import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import type { AutonomyMode } from "./autonomy-mode.js";
import {
  executeToolCalls,
  extractApprovalContext,
  FailureTracker,
  ToolApprovalCancelledError,
  type ToolCallExecutionOptions,
  type ToolResultEntry,
} from "./tool-runner.js";

vi.mock("./index.js", () => ({
  executeTool: vi.fn(),
  getToolEffect: vi.fn(),
}));
vi.mock("#core/loop/context.js", () => ({
  truncateToolResult: vi.fn((text: string) => text),
}));
vi.mock("./guardrails.js", () => ({
  assess: vi.fn(),
}));
vi.mock("#core/util/confirm.js", () => ({
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
vi.mock("#core/config/secrets.js", () => ({
  getSecretStore: vi.fn(() => null),
}));

import { getApprovalQueue } from "#core/daemon/approval-queue.js";
import { truncateToolResult } from "#core/loop/context.js";
import { confirmAction } from "#core/util/confirm.js";
import { assess } from "./guardrails.js";
import { executeTool, getToolEffect } from "./index.js";
import { getToolTelemetry, resetToolTelemetry } from "./tool-telemetry.js";

const mockExecuteTool = vi.mocked(executeTool);
const mockGetToolEffect = vi.mocked(getToolEffect);
const mockTruncate = vi.mocked(truncateToolResult);
const mockAssess = vi.mocked(assess);
const mockConfirmAction = vi.mocked(confirmAction);
const mockGetApprovalQueue = vi.mocked(getApprovalQueue);

const readEffect = {
  kind: "read",
  scope: "local-fs",
  idempotent: true,
  openWorld: false,
} as const;
const writeEffect = {
  kind: "write",
  scope: "local-fs",
  idempotent: false,
  openWorld: false,
} as const;
const destructiveEffect = {
  kind: "destructive",
  scope: "local-fs",
  idempotent: false,
  openWorld: false,
} as const;

const safeAssessment = {
  tool: "file_read",
  risk: "safe" as const,
  policy: "allow" as const,
  reason: "read-only",
};

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

function runOptions(
  overrides: Partial<ToolCallExecutionOptions> = {},
): ToolCallExecutionOptions {
  return {
    resultLimit: 50000,
    verbose: false,
    autonomyMode: "autonomous" as AutonomyMode,
    ...overrides,
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function releaseTool(
  deferreds: Map<string, { resolve: () => void }>,
  name: string,
): void {
  const pending = deferreds.get(name);
  if (!pending) throw new Error(`Tool did not start: ${name}`);
  pending.resolve();
}

function startTracker(): {
  started: string[];
  markStarted: (name: string) => void;
  waitForStart: (name: string) => Promise<void>;
} {
  const started: string[] = [];
  const waiters = new Map<string, Array<() => void>>();
  return {
    started,
    markStarted: (name: string) => {
      started.push(name);
      const waiting = waiters.get(name) ?? [];
      waiters.delete(name);
      for (const resolve of waiting) resolve();
    },
    waitForStart: (name: string) => {
      if (started.includes(name)) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const waiting = waiters.get(name) ?? [];
        waiting.push(resolve);
        waiters.set(name, waiting);
      });
    },
  };
}

function mockDeferredLocalTools(): {
  started: string[];
  deferreds: Map<string, { resolve: () => void }>;
  waitForStart: (name: string) => Promise<void>;
} {
  const tracker = startTracker();
  const deferreds = new Map<string, { resolve: () => void }>();
  mockExecuteTool.mockImplementation(async (name: string) => {
    tracker.markStarted(name);
    const pending = deferred();
    deferreds.set(name, pending);
    await pending.promise;
    return { content: `result:${name}` };
  });
  return { started: tracker.started, deferreds, waitForStart: tracker.waitForStart };
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
    expect(tracker.record(err("f"))).toBe("continue");
  });

  it("handles mixed success/failure results — any error counts as failure", () => {
    const tracker = new FailureTracker();
    const mixed: ToolResultEntry[] = [
      { tool_use_id: "t1", content: "ok" },
      { tool_use_id: "t2", content: "bad", is_error: true },
    ];
    expect(tracker.record(mixed)).toBe("continue");
  });

  it("handles empty results as success (no errors)", () => {
    const tracker = new FailureTracker();
    tracker.record(err("a"));
    tracker.record(err("b"));
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
    expect(tracker.record(twoErrors)).toBe("circuit_break");
  });
});

describe("executeToolCalls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetToolTelemetry();
    mockTruncate.mockImplementation((text: string) => text);
    mockAssess.mockReturnValue(safeAssessment);
    mockGetToolEffect.mockReturnValue(readEffect);
  });

  it("routes tool call to executeTool and returns result", async () => {
    mockExecuteTool.mockResolvedValue({ content: "file contents" });
    const results = await executeToolCalls(
      [toolBlock("file_read", { path: "/a.txt" })],
      runOptions(),
    );
    expect(mockExecuteTool).toHaveBeenCalledWith("file_read", {
      path: "/a.txt",
    }, {
      toolUseId: "t1",
    });
    expect(results).toHaveLength(1);
    expect(results[0].tool_use_id).toBe("t1");
    expect(results[0].content).toBe("file contents");
    expect(results[0].is_error).toBeUndefined();
  });

  it("passes session and tool-use context to local tool runners", async () => {
    mockExecuteTool.mockResolvedValue({ content: "ok" });

    await executeToolCalls(
      [toolBlock("shell", { command: "pwd" }, "tool-42")],
      runOptions({ sessionId: "session-7" }),
    );

    expect(mockExecuteTool).toHaveBeenCalledWith(
      "shell",
      { command: "pwd" },
      { sessionId: "session-7", toolUseId: "tool-42" },
    );
  });

  it("replays provider writes with the same idempotency key and rejects mismatched retries", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-tool-idempotency-"));
    const idempotencyStore = new IdempotencyStore(join(root, "idempotency"), "scope-a");
    try {
      mockGetToolEffect.mockReturnValue(writeEffect);
      mockExecuteTool.mockResolvedValue({ content: "sent" });
      const options = runOptions({ idempotencyStore });

      const first = await executeToolCalls(
        [toolBlock("send_message", { idempotencyKey: "msg-1", text: "hello" })],
        options,
      );
      const replayed = await executeToolCalls(
        [toolBlock("send_message", { idempotencyKey: "msg-1", text: "hello" })],
        options,
      );
      const rejected = await executeToolCalls(
        [toolBlock("send_message", { idempotencyKey: "msg-1", text: "changed" })],
        options,
      );

      expect(first[0].content).toBe("sent");
      expect(first[0]._meta?.idempotency).toEqual({
        status: "accepted",
        key: expect.stringContaining("tool:"),
      });
      expect(replayed[0].content).toBe("sent");
      expect(replayed[0]._meta?.idempotency).toEqual({
        status: "replayed",
        key: expect.stringContaining("tool:"),
      });
      expect(rejected[0].is_error).toBe(true);
      expect(rejected[0].content).toContain("different parameters");
      expect(mockExecuteTool).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("executes multiple read-only tools in parallel", async () => {
    mockExecuteTool.mockResolvedValue({ content: "ok" });
    const blocks = [
      toolBlock("grep", { pattern: "TODO" }, "t1"),
      toolBlock("glob", { pattern: "*.ts" }, "t2"),
    ];
    const results = await executeToolCalls(blocks, runOptions());
    expect(results).toHaveLength(2);
    expect(results[0].tool_use_id).toBe("t1");
    expect(results[1].tool_use_id).toBe("t2");
    expect(mockExecuteTool).toHaveBeenCalledTimes(2);
  });

  it("runs contiguous read-only local tools concurrently and preserves model order", async () => {
    mockGetToolEffect.mockReturnValue(readEffect);
    const { started, deferreds } = mockDeferredLocalTools();

    const pending = executeToolCalls(
      [
        toolBlock("read_slow", {}, "t1"),
        toolBlock("read_fast", {}, "t2"),
      ],
      runOptions(),
    );

    expect(started).toEqual(["read_slow", "read_fast"]);
    releaseTool(deferreds, "read_fast");
    await flushMicrotasks();
    releaseTool(deferreds, "read_slow");

    const results = await pending;
    expect(results.map((result) => result.tool_use_id)).toEqual(["t1", "t2"]);
    expect(results.map((result) => result.content)).toEqual([
      "result:read_slow",
      "result:read_fast",
    ]);
  });

  it("treats web_fetch save_to as an ordered barrier despite its read effect", async () => {
    mockGetToolEffect.mockReturnValue(readEffect);
    const { started, deferreds, waitForStart } = mockDeferredLocalTools();

    const pending = executeToolCalls(
      [
        toolBlock("read_before", {}, "t1"),
        toolBlock(
          "web_fetch",
          { url: "https://example.com", save_to: "data/page.md" },
          "t2",
        ),
        toolBlock("read_after", {}, "t3"),
      ],
      runOptions(),
    );

    expect(started).toEqual(["read_before"]);
    releaseTool(deferreds, "read_before");
    await waitForStart("web_fetch");
    expect(started).toEqual(["read_before", "web_fetch"]);

    await flushMicrotasks();
    expect(started).toEqual(["read_before", "web_fetch"]);

    releaseTool(deferreds, "web_fetch");
    await waitForStart("read_after");
    expect(started).toEqual(["read_before", "web_fetch", "read_after"]);

    releaseTool(deferreds, "read_after");
    const results = await pending;
    expect(results.map((result) => result.tool_use_id)).toEqual(["t1", "t2", "t3"]);
  });

  it("treats mutating and destructive local tools as barriers", async () => {
    mockGetToolEffect.mockImplementation((name: string) => {
      if (name.startsWith("read")) return readEffect;
      if (name === "destroy_one") return destructiveEffect;
      return writeEffect;
    });
    const { started, deferreds, waitForStart } = mockDeferredLocalTools();

    const pending = executeToolCalls(
      [
        toolBlock("read_before", {}, "t1"),
        toolBlock("write_one", {}, "t2"),
        toolBlock("destroy_one", {}, "t3"),
        toolBlock("read_after", {}, "t4"),
      ],
      runOptions(),
    );

    expect(started).toEqual(["read_before"]);
    releaseTool(deferreds, "read_before");
    await waitForStart("write_one");
    expect(started).toEqual(["read_before", "write_one"]);

    releaseTool(deferreds, "write_one");
    await waitForStart("destroy_one");
    expect(started).toEqual(["read_before", "write_one", "destroy_one"]);

    releaseTool(deferreds, "destroy_one");
    await waitForStart("read_after");
    expect(started).toEqual(["read_before", "write_one", "destroy_one", "read_after"]);

    releaseTool(deferreds, "read_after");
    const results = await pending;
    expect(results.map((result) => result.tool_use_id)).toEqual(["t1", "t2", "t3", "t4"]);
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
    expect(mockExecuteTool).toHaveBeenCalledWith("shell", { command: "ls" }, {
      toolUseId: "t1",
    });
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
      runOptions({ guardrailsConfig: confirmConfig }),
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
      runOptions({ guardrailsConfig: confirmConfig }),
    );

    expect(results[0].is_error).toBeUndefined();
    expect(results[0].content).toBe("reset done");
    expect(mockExecuteTool).toHaveBeenCalledWith("shell", { command: "git reset --hard HEAD~1" }, {
      toolUseId: "t1",
    });
  });

  it("blocks a tool call when policy is deny", async () => {
    mockAssess.mockReturnValue({ ...dangerousAssessment, policy: "deny" as const });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "rm -rf /" })],
      runOptions({
        guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "deny" } },
      }),
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
      runOptions({
        guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "queue" } },
        sessionId: "session-1",
      }),
    );

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("Queued for approval");
    expect(results[0].content).toContain("q1");
    expect(results[0].content).toContain("approval CLI");
    expect(results[0].content).not.toContain("Use the approval tool");
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
      "session-1",
    );
  });

  it("uses client approval instead of enqueueing when queue policy is allowed", async () => {
    const mockEnqueue = vi.fn(() => ({ id: "q-client" }));
    mockGetApprovalQueue.mockReturnValue({ enqueue: mockEnqueue } as any);
    mockAssess.mockReturnValue({ ...dangerousAssessment, policy: "queue" as const });
    mockExecuteTool.mockResolvedValue({ content: "executed" });
    const clientApprovalResolver = vi.fn().mockResolvedValue({ outcome: "allow" });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "deploy", API_KEY: "secret-token" })],
      runOptions({
        guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "queue" } },
        sessionId: "session-client",
        clientApprovalResolver,
      }),
    );

    expect(results[0]).toMatchObject({ content: "executed" });
    expect(clientApprovalResolver).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "t1",
        toolUseId: "t1",
        toolName: "shell",
        input: { command: "deploy", API_KEY: "secret-token" },
        risk: "dangerous",
        reason: "destructive command pattern detected",
        sessionId: "session-client",
      }),
    );
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockExecuteTool).toHaveBeenCalled();
  });

  it("blocks a queue-policy tool when client approval denies it", async () => {
    const mockEnqueue = vi.fn(() => ({ id: "q-client-deny" }));
    mockGetApprovalQueue.mockReturnValue({ enqueue: mockEnqueue } as any);
    mockAssess.mockReturnValue({ ...dangerousAssessment, policy: "queue" as const });
    const clientApprovalResolver = vi.fn().mockResolvedValue({
      outcome: "deny",
      message: "operator rejected",
    });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "rm -rf /tmp/old" })],
      runOptions({
        guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "queue" } },
        clientApprovalResolver,
      }),
    );

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("operator rejected");
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("throws when client approval reports cancellation", async () => {
    mockAssess.mockReturnValue({ ...dangerousAssessment, policy: "queue" as const });
    const clientApprovalResolver = vi.fn().mockResolvedValue({
      outcome: "cancelled",
      message: "prompt cancelled",
    });

    await expect(
      executeToolCalls(
        [toolBlock("shell", { command: "rm -rf /tmp/old" })],
        runOptions({
          guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "queue" } },
          clientApprovalResolver,
        }),
      ),
    ).rejects.toThrow(ToolApprovalCancelledError);
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("emits guardrail event to transport", async () => {
    mockAssess.mockReturnValue({ ...dangerousAssessment, policy: "deny" as const });
    const transport = { emit: vi.fn() };

    await executeToolCalls(
      [toolBlock("shell", { command: "rm -rf /" })],
      runOptions({
        transport: transport as never,
        guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "deny" } },
      }),
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
      runOptions({
        guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "queue" } },
        sessionId: "session-2",
        messages,
      }),
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
      runOptions({
        guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "deny" } },
        sessionId: "session-42",
      }),
    );

    expect(tryEmitMock).toHaveBeenCalledWith(
      "guardrail.assessed",
      expect.objectContaining({ tool: "shell", risk: "dangerous", policy: "deny", session: "session-42" }),
    );
  });
});

describe("autonomy-mode gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTruncate.mockImplementation((text: string) => text);
    mockGetApprovalQueue.mockReturnValue({ enqueue: vi.fn(() => ({ id: "abc123" })) } as any);
  });

  it("passive mode denies a non-safe tool before policy resolution", async () => {
    mockAssess.mockReturnValue({
      tool: "shell",
      risk: "moderate",
      policy: "allow",
      reason: "writes a file",
    });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "touch x" })],
      runOptions({ autonomyMode: "passive" }),
    );

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("passive");
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("passive mode still allows safe tools to run", async () => {
    mockAssess.mockReturnValue(safeAssessment);
    mockExecuteTool.mockResolvedValue({ content: "ok" });

    const results = await executeToolCalls(
      [toolBlock("file_read", { path: "/a.txt" })],
      runOptions({ autonomyMode: "passive" }),
    );

    expect(results[0].is_error).toBeUndefined();
    expect(mockExecuteTool).toHaveBeenCalled();
  });

  it("supervised mode queues a non-safe tool through the approval queue", async () => {
    const mockEnqueue = vi.fn(() => ({ id: "q-supervised" }));
    mockGetApprovalQueue.mockReturnValue({ enqueue: mockEnqueue } as any);
    mockAssess.mockReturnValue({
      tool: "shell",
      risk: "moderate",
      policy: "allow",
      reason: "writes a file",
    });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "touch x" })],
      runOptions({ autonomyMode: "supervised", sessionId: "s-1" }),
    );

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("Queued for approval");
    expect(results[0].content).toContain("approval CLI");
    expect(results[0].content).not.toContain("Use the approval tool");
    expect(mockEnqueue).toHaveBeenCalled();
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("treats client allow as the supervised approval boundary when policy allows", async () => {
    const mockEnqueue = vi.fn(() => ({ id: "q-supervised-client" }));
    mockGetApprovalQueue.mockReturnValue({ enqueue: mockEnqueue } as any);
    mockAssess.mockReturnValue({ ...dangerousAssessment, policy: "allow" as const });
    mockConfirmAction.mockResolvedValue(false);
    mockExecuteTool.mockResolvedValue({ content: "executed after ACP allow" });
    const clientApprovalResolver = vi.fn().mockResolvedValue({ outcome: "allow" });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "deploy" })],
      runOptions({
        autonomyMode: "supervised",
        guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "allow" } },
        sessionId: "s-acp",
        clientApprovalResolver,
      }),
    );

    expect(results[0]).toMatchObject({ content: "executed after ACP allow" });
    expect(clientApprovalResolver).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "shell",
        reason: expect.stringContaining('autonomy mode "supervised"'),
        sessionId: "s-acp",
      }),
    );
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockConfirmAction).not.toHaveBeenCalled();
    expect(mockExecuteTool).toHaveBeenCalled();
  });

  it("does not let supervised client approval bypass a deny policy", async () => {
    const mockEnqueue = vi.fn(() => ({ id: "q-supervised-deny" }));
    mockGetApprovalQueue.mockReturnValue({ enqueue: mockEnqueue } as any);
    mockAssess.mockReturnValue({ ...dangerousAssessment, policy: "deny" as const });
    mockExecuteTool.mockResolvedValue({ content: "should not run" });
    const clientApprovalResolver = vi.fn().mockResolvedValue({ outcome: "allow" });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "deploy" })],
      runOptions({
        autonomyMode: "supervised",
        guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "deny" } },
        sessionId: "s-acp-deny",
        clientApprovalResolver,
      }),
    );

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("Blocked by guardrails");
    expect(clientApprovalResolver).toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockConfirmAction).not.toHaveBeenCalled();
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("still enforces confirm policy after supervised client approval", async () => {
    const mockEnqueue = vi.fn(() => ({ id: "q-supervised-confirm" }));
    mockGetApprovalQueue.mockReturnValue({ enqueue: mockEnqueue } as any);
    mockAssess.mockReturnValue(dangerousAssessment);
    mockConfirmAction.mockResolvedValue(false);
    mockExecuteTool.mockResolvedValue({ content: "should not run" });
    const clientApprovalResolver = vi.fn().mockResolvedValue({ outcome: "allow" });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "deploy" })],
      runOptions({
        autonomyMode: "supervised",
        guardrailsConfig: confirmConfig,
        sessionId: "s-acp-confirm",
        clientApprovalResolver,
      }),
    );

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("requires confirmation");
    expect(clientApprovalResolver).toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockConfirmAction).toHaveBeenCalled();
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("autonomous mode falls through to policy resolution", async () => {
    mockAssess.mockReturnValue({
      tool: "shell",
      risk: "moderate",
      policy: "allow",
      reason: "writes a file",
    });
    mockExecuteTool.mockResolvedValue({ content: "ok" });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "touch x" })],
      runOptions({ autonomyMode: "autonomous" }),
    );

    expect(results[0].is_error).toBeUndefined();
    expect(mockExecuteTool).toHaveBeenCalled();
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
    expect(ctx!.length).toBeLessThanOrEqual(101);
    expect(ctx).toMatch(/…$/);
  });
});
