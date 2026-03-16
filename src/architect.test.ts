import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Hoisted mocks ---
const { mockExecuteTool } = vi.hoisted(() => ({
  mockExecuteTool: vi.fn(),
}));

vi.mock("./tools/index.js", () => ({
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
}));

import { runArchitectPass, runEditorLoop } from "./architect.js";
import { enableGroup, resetGroups } from "./tool-groups.js";

// --- Helpers ---

function mockUsage(overrides: Partial<Anthropic.Messages.Usage> = {}): Anthropic.Messages.Usage {
  return {
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    server_tool_use: undefined,
    service_tier: undefined,
    ...overrides,
  } as Anthropic.Messages.Usage;
}

type MockMessage = Partial<Anthropic.Message> & { _text?: string };

function createMockStream(opts: MockMessage = {}) {
  const textContent = opts._text ?? "";
  return {
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "text" && textContent) handler(textContent);
      return this;
    },
    async finalMessage(): Promise<Anthropic.Message> {
      const { _text: _, ...rest } = opts;
      return {
        id: "msg_test",
        type: "message",
        role: "assistant",
        content: textContent
          ? [{ type: "text" as const, text: textContent }]
          : [],
        model: "test-model",
        stop_reason: "end_turn",
        usage: mockUsage(),
        ...rest,
      } as Anthropic.Message;
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
  return { messages: { stream: vi.fn() } } as unknown as
    Anthropic & { messages: { stream: ReturnType<typeof vi.fn> } };
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
      costTracker: mockTracker as unknown as import("./cost.js").CostTracker,
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

    expect(result).toEqual({ text: "All changes complete.", modifiedFiles: [] });
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
    expect(result).toEqual({ text: "Done editing.", modifiedFiles: [] });
    expect(client.messages.stream).toHaveBeenCalledTimes(2);
  });

  it("exposes core EDITOR_TOOL_SET tools by default", async () => {
    client.messages.stream.mockReturnValue(createMockStream({ _text: "done" }));

    await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "test",
    });

    const callArgs = client.messages.stream.mock.calls[0][0];
    const toolNames = callArgs.tools.map((t: Anthropic.Tool) => t.name);
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
    const toolNames = callArgs.tools.map((t: Anthropic.Tool) => t.name);
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
    const toolNames = callArgs.tools.map((t: Anthropic.Tool) => t.name);
    expect(toolNames).toContain("code_exec");
  });

  it("includes multi_edit when advanced_editing group is enabled", async () => {
    enableGroup("advanced_editing");
    client.messages.stream.mockReturnValue(createMockStream({ _text: "done" }));

    await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "test",
    });

    const callArgs = client.messages.stream.mock.calls[0][0];
    const toolNames = callArgs.tools.map((t: Anthropic.Tool) => t.name);
    expect(toolNames).toContain("multi_edit");
  });

  it("never includes delegate or ask_user even with all groups enabled", async () => {
    enableGroup("all");
    client.messages.stream.mockReturnValue(createMockStream({ _text: "done" }));

    await runEditorLoop({
      client, model: "test", maxTokens: 1000, plan: "test",
    });

    const callArgs = client.messages.stream.mock.calls[0][0];
    const toolNames = callArgs.tools.map((t: Anthropic.Tool) => t.name);
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
      costTracker: mockTracker as unknown as import("./cost.js").CostTracker,
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

    expect(result).toEqual({ text: "", modifiedFiles: [] });
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
});
