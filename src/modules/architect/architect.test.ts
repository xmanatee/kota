import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  KotaModelResponse,
  KotaModelUsage,
  KotaTool,
} from "#core/agent-harness/message-protocol.js";
import type { ModelClient } from "#core/model/model-client.js";

// --- Hoisted mocks ---
const { mockExecuteTool } = vi.hoisted(() => ({
  mockExecuteTool: vi.fn(),
}));

vi.mock("#core/tools/index.js", () => ({
  getAllTools: () => [
    { name: "file_read", description: "read", input_schema: { type: "object", properties: {} } },
    { name: "file_edit", description: "edit", input_schema: { type: "object", properties: {} } },
    { name: "file_write", description: "write", input_schema: { type: "object", properties: {} } },
    { name: "shell", description: "shell", input_schema: { type: "object", properties: {} } },
    { name: "grep", description: "grep", input_schema: { type: "object", properties: {} } },
    { name: "glob", description: "glob", input_schema: { type: "object", properties: {} } },
    { name: "web_search", description: "search", input_schema: { type: "object", properties: {} } },
    { name: "web_fetch", description: "fetch", input_schema: { type: "object", properties: {} } },
    { name: "code_exec", description: "code", input_schema: { type: "object", properties: {} } },
    { name: "multi_edit", description: "multi", input_schema: { type: "object", properties: {} } },
    { name: "delegate", description: "delegate", input_schema: { type: "object", properties: {} } },
    { name: "ask_user", description: "ask", input_schema: { type: "object", properties: {} } },
  ],
  executeTool: mockExecuteTool,
  getToolEffect: (...args: Parameters<typeof resolveRegisteredToolEffect>) => resolveRegisteredToolEffect(...args),
}));

import { localWriteEffect, readOnlyLocalEffect } from "#core/tools/effect.js";
import { getAllTools } from "#core/tools/index.js";
import { deregisterLocalToolApprovalBinding, registerLocalToolApprovalBinding } from "#core/tools/local-tool-approval-binding.js";
import { deleteModuleToolEffect, resolveRegisteredToolEffect, setModuleToolEffect } from "#core/tools/tool-effect-registry.js";
import { enableGroup, resetGroups } from "#core/tools/tool-groups.js";
import { executeToolCalls } from "#core/tools/tool-runner-execution.js";
import { runArchitectPass } from "./architect.js";
import { type EditorOptions, runEditorLoop as executeEditorLoop } from "./architect-editor.js";

const runEditorLoop = (options: Omit<EditorOptions, "executeTools">) =>
  executeEditorLoop({ ...options, executeTools: async (blocks) => Promise.all(blocks.map(async (block) => ({
    tool_use_id: block.id,
    ...await mockExecuteTool(block.name, block.input),
  }))) });

// --- Helpers ---

function mockUsage(overrides: Partial<KotaModelUsage> = {}): KotaModelUsage {
  return {
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    ...overrides,
  };
}

type MockMessage = Partial<KotaModelResponse> & { _text?: string };

function createMockStream(opts: MockMessage = {}) {
  const textContent = opts._text ?? "";
  return {
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "text" && textContent) handler(textContent);
      return this;
    },
    async finalMessage(): Promise<KotaModelResponse> {
      const { _text: _, ...rest } = opts;
      return {
        id: "msg_test",
        role: "assistant",
        content: textContent
          ? [{ type: "text" as const, text: textContent }]
          : [],
        model: "test-model",
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: mockUsage(),
        ...rest,
      };
    },
  };
}

function toolUseContent(calls: { id: string; name: string; input: Record<string, unknown> }[]) {
  return calls.map((c) => ({
    type: "tool_use" as const,
    id: c.id,
    name: c.name,
    input: c.input,
  }));
}

function createMockClient() {
  return { messages: { stream: vi.fn(), create: vi.fn() } } as unknown as
    ModelClient & { messages: { stream: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> } };
}

// --- Tests ---

describe("runArchitectPass", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.restoreAllMocks();
    client = createMockClient();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  it("returns plan text from streamed response", async () => {
    client.messages.stream.mockReturnValue(
      createMockStream({ _text: "Step 1: Create file\nStep 2: Edit file" }),
    );

    const plan = await runArchitectPass({
      client, model: "test", maxTokens: 1000,
      systemContext: "test context",
      messages: [{ role: "user", content: "build something" }],
    });

    expect(plan).toBe("Step 1: Create file\nStep 2: Edit file");
  });

  it("tracks cost via CostTracker", async () => {
    const usage = mockUsage({ input_tokens: 200, output_tokens: 100 });
    client.messages.stream.mockReturnValue(
      createMockStream({ _text: "plan", usage }),
    );
    const mockTracker = { addUsage: vi.fn() };

    await runArchitectPass({
      client, model: "claude-test", maxTokens: 1000,
      systemContext: "", messages: [{ role: "user", content: "test" }],
      costTracker: mockTracker as unknown as import("#core/loop/cost.js").CostTracker,
    });

    expect(mockTracker.addUsage).toHaveBeenCalledWith("claude-test", usage);
  });

  it("uses cache_control on system prompt", async () => {
    client.messages.stream.mockReturnValue(createMockStream({ _text: "plan" }));

    await runArchitectPass({
      client, model: "test", maxTokens: 1000,
      systemContext: "ctx",
      messages: [{ role: "user", content: "test" }],
    });

    const callArgs = client.messages.stream.mock.calls[0][0];
    expect(callArgs.system).toEqual([
      expect.objectContaining({
        type: "text",
        cache_control: { type: "ephemeral" },
      }),
    ]);
  });

  it("returns empty string when model produces no text", async () => {
    client.messages.stream.mockReturnValue(createMockStream({}));

    const plan = await runArchitectPass({
      client, model: "test", maxTokens: 1000,
      systemContext: "", messages: [{ role: "user", content: "test" }],
    });

    expect(plan).toBe("");
  });

  it("includes thinking config when provided", async () => {
    client.messages.stream.mockReturnValue(createMockStream({ _text: "plan" }));
    const thinking = { type: "enabled" as const, budget_tokens: 5000 };

    await runArchitectPass({
      client, model: "test", maxTokens: 1000,
      systemContext: "", messages: [{ role: "user", content: "test" }],
      thinking,
    });

    const callArgs = client.messages.stream.mock.calls[0][0];
    expect(callArgs.thinking).toEqual(thinking);
  });

  it("retries transient API errors in architect pass", async () => {
    let callCount = 0;
    client.messages.stream.mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw Object.assign(new Error("overloaded"), { status: 529 });
      return createMockStream({ _text: "Planned after retry." });
    });

    const plan = await runArchitectPass({
      client, model: "test", maxTokens: 1000,
      systemContext: "", messages: [{ role: "user", content: "test" }],
    });

    expect(callCount).toBe(2);
    expect(plan).toBe("Planned after retry.");
  });

  it("throws immediately for non-retryable architect errors", async () => {
    client.messages.stream.mockImplementation(() => {
      throw Object.assign(new Error("bad request"), { status: 400 });
    });

    await expect(
      runArchitectPass({
        client, model: "test", maxTokens: 1000,
        systemContext: "", messages: [{ role: "user", content: "test" }],
      }),
    ).rejects.toThrow("bad request");
    expect(client.messages.stream).toHaveBeenCalledTimes(1);
  });
});

describe("runEditorLoop", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.restoreAllMocks();
    resetGroups();
    client = createMockClient();
    mockExecuteTool.mockReset();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  it("returns text when model produces no tool calls", async () => {
    client.messages.stream.mockReturnValue(
      createMockStream({ _text: "All changes complete." }),
    );

    const result = await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "Edit the file",
    });

    expect(result).toEqual({ text: "All changes complete." });
  });

  it("preserves write-before-read ordering through the session executor", async () => {
    client.messages.stream
      .mockReturnValueOnce(createMockStream({ content: toolUseContent([
        { id: "write", name: "file_write", input: { path: "example.txt" } },
        { id: "forbidden", name: "delegate", input: {} },
        { id: "read", name: "file_read", input: { path: "example.txt" } },
      ]) }))
      .mockReturnValueOnce(createMockStream({ _text: "Done." }));
    let written = false;
    let readBeforeWrite = false;
    mockExecuteTool.mockImplementation(async (name: string) => {
      if (name === "file_write") {
        await new Promise((resolve) => setTimeout(resolve, 20));
        written = true;
      } else {
        readBeforeWrite = !written;
      }
      return { content: written ? "updated" : "stale" };
    });
    for (const tool of getAllTools().filter((tool) => ["file_read", "file_write"].includes(tool.name))) {
      registerLocalToolApprovalBinding(tool, (input, context) => mockExecuteTool(tool.name, input, context), {
        effect: tool.name === "file_read" ? readOnlyLocalEffect() : localWriteEffect(),
      });
    }
    setModuleToolEffect("file_write", { effect: localWriteEffect() });
    setModuleToolEffect("file_read", { effect: readOnlyLocalEffect() });
    try {
      await executeEditorLoop({
        client, model: "test", maxTokens: 1000, plan: "Write then read",
        executeTools: (blocks) => executeToolCalls(blocks, {
          resultLimit: 30000, verbose: false, autonomyMode: "autonomous",
        }),
      });
      expect(readBeforeWrite).toBe(false);
      expect(mockExecuteTool.mock.calls.map(([name]) => name)).toEqual(["file_write", "file_read"]);
      const results = client.messages.stream.mock.calls[1][0].messages[2].content;
      expect(results.map((result: { tool_use_id: string }) => result.tool_use_id)).toEqual(["write", "forbidden", "read"]);
      expect(results[1].is_error).toBe(true);
    } finally {
      deregisterLocalToolApprovalBinding("file_write");
      deregisterLocalToolApprovalBinding("file_read");
      deleteModuleToolEffect("file_write");
      deleteModuleToolEffect("file_read");
    }
  });

  it("executes tools and continues until model stops", async () => {
    client.messages.stream
      .mockReturnValueOnce(
        createMockStream({
          content: toolUseContent([{ id: "t1", name: "file_read", input: { path: "test.ts" } }]),
        }),
      )
      .mockReturnValueOnce(createMockStream({ _text: "Done editing." }));

    mockExecuteTool.mockResolvedValue({ content: "file contents here" });

    const result = await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "Read and edit",
    });

    expect(mockExecuteTool).toHaveBeenCalledWith("file_read", { path: "test.ts" });
    expect(result).toEqual({ text: "Done editing." });
    expect(client.messages.stream).toHaveBeenCalledTimes(2);
  });

  it("exposes core EDITOR_TOOL_SET tools by default", async () => {
    client.messages.stream.mockReturnValue(createMockStream({ _text: "done" }));

    await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "test",
    });

    const callArgs = client.messages.stream.mock.calls[0][0];
    const toolNames = callArgs.tools.map((t: KotaTool) => t.name);
    expect(toolNames).toContain("file_read");
    expect(toolNames).toContain("file_edit");
    expect(toolNames).toContain("file_write");
    expect(toolNames).toContain("shell");
    expect(toolNames).toContain("grep");
    expect(toolNames).toContain("glob");
    expect(toolNames).not.toContain("delegate");
    expect(toolNames).not.toContain("ask_user");
    expect(toolNames).not.toContain("enable_tools");
  });

  it("includes web tools when web group is enabled", async () => {
    enableGroup("web");
    client.messages.stream.mockReturnValue(createMockStream({ _text: "done" }));

    await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "test",
    });

    const callArgs = client.messages.stream.mock.calls[0][0];
    const toolNames = callArgs.tools.map((t: KotaTool) => t.name);
    expect(toolNames).toContain("web_search");
    expect(toolNames).toContain("web_fetch");
  });

  it("includes code_exec when code group is enabled", async () => {
    enableGroup("code");
    client.messages.stream.mockReturnValue(createMockStream({ _text: "done" }));

    await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "test",
    });

    const callArgs = client.messages.stream.mock.calls[0][0];
    const toolNames = callArgs.tools.map((t: KotaTool) => t.name);
    expect(toolNames).toContain("code_exec");
  });

  it("includes multi_edit when advanced_editing group is enabled", async () => {
    enableGroup("advanced_editing");
    client.messages.stream.mockReturnValue(createMockStream({ _text: "done" }));

    await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "test",
    });

    const callArgs = client.messages.stream.mock.calls[0][0];
    const toolNames = callArgs.tools.map((t: KotaTool) => t.name);
    expect(toolNames).toContain("multi_edit");
  });

  it("never includes delegate or ask_user even with all groups enabled", async () => {
    enableGroup("all");
    client.messages.stream.mockReturnValue(createMockStream({ _text: "done" }));

    await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "test",
    });

    const callArgs = client.messages.stream.mock.calls[0][0];
    const toolNames = callArgs.tools.map((t: KotaTool) => t.name);
    expect(toolNames).not.toContain("delegate");
    expect(toolNames).not.toContain("ask_user");
    expect(toolNames).not.toContain("enable_tools");
  });

  it("tracks cost for each turn", async () => {
    const usage1 = mockUsage({ input_tokens: 100, output_tokens: 50 });
    const usage2 = mockUsage({ input_tokens: 150, output_tokens: 60 });

    client.messages.stream
      .mockReturnValueOnce(
        createMockStream({
          content: toolUseContent([{ id: "t1", name: "file_read", input: {} }]),
          usage: usage1,
        }),
      )
      .mockReturnValueOnce(createMockStream({ _text: "done", usage: usage2 }));

    mockExecuteTool.mockResolvedValue({ content: "ok" });
    const mockTracker = { addUsage: vi.fn() };

    await runEditorLoop({
      client, model: "test-model", maxTokens: 1000, plan: "test",
      costTracker: mockTracker as unknown as import("#core/loop/cost.js").CostTracker,
    });

    expect(mockTracker.addUsage).toHaveBeenCalledTimes(2);
    expect(mockTracker.addUsage).toHaveBeenCalledWith("test-model", usage1);
    expect(mockTracker.addUsage).toHaveBeenCalledWith("test-model", usage2);
  });

  it("truncates large tool results", async () => {
    const largeContent = "x".repeat(50_000);

    client.messages.stream
      .mockReturnValueOnce(
        createMockStream({
          content: toolUseContent([{ id: "t1", name: "file_read", input: {} }]),
        }),
      )
      .mockReturnValueOnce(createMockStream({ _text: "done" }));

    mockExecuteTool.mockResolvedValue({ content: largeContent });

    await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "test",
    });

    // Second API call should contain truncated tool result in messages
    expect(client.messages.stream).toHaveBeenCalledTimes(2);
    const secondCall = client.messages.stream.mock.calls[1][0];
    // messages: [user(plan), assistant(tool_use), user(tool_result)]
    const toolResultMsg = secondCall.messages[2];
    expect(toolResultMsg.role).toBe("user");
    const toolResults = toolResultMsg.content as Array<{ type: string; content: string }>;
    expect(toolResults[0].type).toBe("tool_result");
    expect(toolResults[0].content.length).toBeLessThan(largeContent.length);
    expect(toolResults[0].content).toContain("chars omitted");
  });

  it("handles context overflow gracefully", async () => {
    client.messages.stream.mockImplementation(() => {
      throw new Error("Request too long: context length exceeded");
    });

    // Should not throw — returns empty string
    const result = await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "test",
    });

    expect(result).toEqual({ text: "" });
  });

  it("re-throws non-retryable errors after exhausting retries", async () => {
    client.messages.stream.mockImplementation(() => {
      throw Object.assign(new Error("authentication failed"), { status: 401 });
    });

    await expect(
      runEditorLoop({ client, model: "test", maxTokens: 1000, plan: "test" }),
    ).rejects.toThrow("authentication failed");
    // Non-retryable (401) — should only try once
    expect(client.messages.stream).toHaveBeenCalledTimes(1);
  });

  it("retries transient errors in editor loop", async () => {
    let callCount = 0;
    client.messages.stream.mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw Object.assign(new Error("Service unavailable"), { status: 503 });
      return createMockStream({ _text: "Done after retry." });
    });

    const result = await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "test",
    });

    expect(callCount).toBe(2);
    expect(result.text).toBe("Done after retry.");
  });

  it("uses cache_control on editor system prompt", async () => {
    client.messages.stream.mockReturnValue(createMockStream({ _text: "done" }));

    await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "test",
    });

    const callArgs = client.messages.stream.mock.calls[0][0];
    expect(callArgs.system).toEqual([
      expect.objectContaining({
        type: "text",
        cache_control: { type: "ephemeral" },
      }),
    ]);
  });

  it("emits error when editor hits MAX_EDITOR_TURNS", async () => {
    // Set up mock to always return tool calls (never finishes)
    mockExecuteTool.mockResolvedValue({ content: "ok" });
    client.messages.stream.mockImplementation(() =>
      createMockStream({
        content: toolUseContent([
          { id: `t${Math.random()}`, name: "file_read", input: { path: "test.ts" } },
        ]),
      }),
    );

    const events: Array<{ type: string; message?: string }> = [];
    const transport = {
      emit(event: { type: string; message?: string }) { events.push(event); },
    };

    await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "test",
      transport: transport as import("#core/loop/transport.js").Transport,
    });

    const turnLimitError = events.find(
      (e) => e.type === "error" && e.message?.includes("turn limit"),
    );
    expect(turnLimitError).toBeDefined();
    expect(turnLimitError!.message).toContain("30");
  });

  it("does not emit turn limit error when model finishes normally", async () => {
    client.messages.stream.mockReturnValue(createMockStream({ _text: "done" }));

    const events: Array<{ type: string; message?: string }> = [];
    const transport = {
      emit(event: { type: string; message?: string }) { events.push(event); },
    };

    await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "test",
      transport: transport as import("#core/loop/transport.js").Transport,
    });

    const turnLimitError = events.find(
      (e) => e.type === "error" && e.message?.includes("turn limit"),
    );
    expect(turnLimitError).toBeUndefined();
  });

  it("triggers replanning after 3 consecutive tool errors", async () => {
    let streamCallCount = 0;
    // 3 turns of failing tool calls, then replanner says REVISE, then model finishes
    client.messages.stream.mockImplementation(() => {
      streamCallCount++;
      if (streamCallCount <= 3) {
        return createMockStream({
          content: toolUseContent([
            { id: `t${streamCallCount}`, name: "file_edit", input: { path: "a.ts" } },
          ]),
        });
      }
      return createMockStream({ _text: "Done after replan." });
    });

    mockExecuteTool.mockResolvedValue({ content: "old_string not found", is_error: true });

    // Mock replanner response
    client.messages.create.mockResolvedValue({
      content: [{ type: "text", text: "DECISION: REVISE\n1. Read the file first\n2. Then edit" }],
      usage: mockUsage(),
    });

    const events: Array<{ type: string; message?: string }> = [];
    const transport = {
      emit(event: { type: string; message?: string }) { events.push(event); },
    };

    const result = await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "Edit a.ts",
      transport: transport as import("#core/loop/transport.js").Transport,
    });

    expect(result.text).toBe("Done after replan.");
    expect(result.replans).toBe(1);
    expect(client.messages.create).toHaveBeenCalledTimes(1);

    const replanEvent = events.find((e) => e.message?.includes("Replanning"));
    expect(replanEvent).toBeDefined();
    const revisedEvent = events.find((e) => e.message?.includes("Plan revised"));
    expect(revisedEvent).toBeDefined();
  });

  it("aborts execution when replanner returns ABORT", async () => {
    // 3 failing turns then replanner says ABORT
    client.messages.stream.mockImplementation(() =>
      createMockStream({
        content: toolUseContent([
          { id: `t${Math.random()}`, name: "shell", input: { command: "fail" } },
        ]),
      }),
    );

    mockExecuteTool.mockResolvedValue({ content: "command not found", is_error: true });

    client.messages.create.mockResolvedValue({
      content: [{ type: "text", text: "DECISION: ABORT\nThe command does not exist on this system." }],
      usage: mockUsage(),
    });

    const events: Array<{ type: string; message?: string }> = [];
    const transport = {
      emit(event: { type: string; message?: string }) { events.push(event); },
    };

    const result = await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "Run the command",
      transport: transport as import("#core/loop/transport.js").Transport,
    });

    expect(result.text).toContain("Plan aborted");
    const abortEvent = events.find((e) => e.type === "error" && e.message?.includes("aborted"));
    expect(abortEvent).toBeDefined();
  });

  it("continues without replanning when replanner says CONTINUE", async () => {
    let streamCallCount = 0;
    // 3 failing turns (different errors to avoid stagnation), replanner says CONTINUE, then success
    client.messages.stream.mockImplementation(() => {
      streamCallCount++;
      if (streamCallCount <= 3) {
        return createMockStream({
          content: toolUseContent([
            { id: `t${streamCallCount}`, name: "file_edit", input: { path: "b.ts" } },
          ]),
        });
      }
      return createMockStream({ _text: "Completed." });
    });

    let errorCount = 0;
    mockExecuteTool.mockImplementation(() => {
      errorCount++;
      return { content: `error variant ${errorCount}`, is_error: true };
    });

    client.messages.create.mockResolvedValue({
      content: [{ type: "text", text: "DECISION: CONTINUE" }],
      usage: mockUsage(),
    });

    const result = await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "Edit b.ts",
    });

    expect(result.replans).toBe(1);
  });

  it("limits replanning to MAX_REPLANS (2)", async () => {
    // Continuously failing — should trigger replan twice then stop
    client.messages.stream.mockImplementation(() =>
      createMockStream({
        content: toolUseContent([
          { id: `t${Math.random()}`, name: "shell", input: { command: "x" } },
        ]),
      }),
    );

    mockExecuteTool.mockResolvedValue({ content: "error", is_error: true });

    client.messages.create.mockResolvedValue({
      content: [{ type: "text", text: "DECISION: REVISE\n1. Try differently" }],
      usage: mockUsage(),
    });

    await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "test",
    });

    // Should have called replanner exactly 2 times (MAX_REPLANS)
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it("does not replan when tool calls succeed", async () => {
    client.messages.stream
      .mockReturnValueOnce(
        createMockStream({
          content: toolUseContent([{ id: "t1", name: "file_read", input: { path: "a.ts" } }]),
        }),
      )
      .mockReturnValueOnce(
        createMockStream({
          content: toolUseContent([{ id: "t2", name: "file_edit", input: { path: "a.ts" } }]),
        }),
      )
      .mockReturnValueOnce(createMockStream({ _text: "Done." }));

    mockExecuteTool.mockResolvedValue({ content: "ok" });

    const result = await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "test",
    });

    expect(result.replans).toBeUndefined();
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("detects stagnation and triggers replanning", async () => {
    let streamCallCount = 0;
    // 2 identical failures (stagnation), then replan, then success
    client.messages.stream.mockImplementation(() => {
      streamCallCount++;
      if (streamCallCount <= 2) {
        return createMockStream({
          content: toolUseContent([
            { id: `t${streamCallCount}`, name: "file_edit", input: { path: "x.ts" } },
          ]),
        });
      }
      return createMockStream({ _text: "Fixed." });
    });

    mockExecuteTool.mockResolvedValue({ content: "old_string not found", is_error: true });

    client.messages.create.mockResolvedValue({
      content: [{ type: "text", text: "DECISION: REVISE\n1. Read the file first" }],
      usage: mockUsage(),
    });

    const result = await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "Edit x.ts",
    });

    expect(result.text).toBe("Fixed.");
    expect(result.replans).toBe(1);
  });

  it("injects revised plan into editor conversation", async () => {
    let streamCallCount = 0;
    client.messages.stream.mockImplementation(() => {
      streamCallCount++;
      if (streamCallCount <= 3) {
        return createMockStream({
          content: toolUseContent([
            { id: `t${streamCallCount}`, name: "shell", input: { command: "fail" } },
          ]),
        });
      }
      return createMockStream({ _text: "Done." });
    });

    mockExecuteTool.mockResolvedValue({ content: "error", is_error: true });

    client.messages.create.mockResolvedValue({
      content: [{ type: "text", text: "DECISION: REVISE\nNew approach: read first" }],
      usage: mockUsage(),
    });

    await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "test",
    });

    // The 4th stream call should contain the revised plan in messages
    const lastStreamCall = client.messages.stream.mock.calls[3][0];
    const messages = lastStreamCall.messages as Array<{ role: string; content: string | unknown[] }>;
    const replanMsg = messages.find(
      (m) => typeof m.content === "string" && m.content.includes("[Plan revised]"),
    );
    expect(replanMsg).toBeDefined();
    expect(replanMsg!.content).toContain("New approach: read first");
  });
});
