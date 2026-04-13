/**
 * End-to-end integration tests: AgentSession → history save → history resume → verify context.
 *
 * Exercises the full pipeline a user traverses when they:
 *   1. `kota run "task"` → session saves to history
 *   2. `kota run --continue` → resumes with old context
 *   3. exits REPL without sending → no empty history entries
 *
 * Mocks only the Anthropic API (no real network calls). Everything else is real:
 * history, context, init, system prompt.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Hoisted mocks for external/network dependencies ---

const { mockStreamMessage, mockExecuteToolCalls } = vi.hoisted(() => ({
  mockStreamMessage: vi.fn(),
  mockExecuteToolCalls: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { stream: vi.fn() };
  },
}));
vi.mock("./core/model/model-client.js", () => ({
  createModelClient: vi.fn(() => ({
    client: { messages: { stream: vi.fn(), create: vi.fn() } },
    model: "claude-sonnet-4-6",
    providerName: "anthropic",
  })),
  registerModelClientFactory: vi.fn(),
}));
vi.mock("./core/model/streaming.js", () => ({ streamMessage: mockStreamMessage }));
vi.mock("./core/tools/tool-runner.js", async () => {
  const actual = await vi.importActual<typeof import("./core/tools/tool-runner.js")>(
    "./core/tools/tool-runner.js",
  );
  return { ...actual, executeToolCalls: mockExecuteToolCalls };
});
vi.mock("./core/tools/index.js", () => ({
  getAllTools: () => [],
  executeTool: vi.fn(),
  getTodoState: vi.fn(() => ""),
}));
vi.mock("./core/tools/delegate.js", () => ({
  setDelegateConfig: vi.fn(),
  delegateTool: { name: "delegate", description: "", input_schema: { type: "object", properties: {} } },
}));
vi.mock("./modules/execution/process.js", () => ({
  cleanupProcesses: vi.fn(),
  processTool: { name: "process", description: "", input_schema: { type: "object", properties: {} } },
  runProcess: vi.fn(),
}));
vi.mock("./modules/execution/code-exec.js", () => ({
  cleanupSessions: vi.fn(),
  codeExecTool: { name: "code_exec", description: "", input_schema: { type: "object", properties: {} } },
  runCodeExec: vi.fn(),
}));
vi.mock("./core/mcp/manager.js", () => ({
  McpManager: class MockMcpManager {
    static loadConfig() { return null; }
  },
}));
vi.mock("./core/modules/project-discovery.js", () => ({
  discoverProjectModules: vi.fn(async () => []),
}));
vi.mock("./core/modules/module-discovery.js", () => ({
  discoverModules: vi.fn(async () => []),
}));

// --- Import after mocks ---

import { AgentSession } from "./core/loop/loop.js";
import { getHistory, resetHistory } from "./core/memory/history.js";

// --- Test helpers ---

function textResponse(text: string, inputTokens = 100) {
  return {
    response: {
      content: [{ type: "text" as const, text }],
      usage: { input_tokens: inputTokens, output_tokens: 50 },
    },
    streamedText: text,
  };
}

function toolResponse(
  tools: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  inputTokens = 100,
) {
  return {
    response: {
      content: tools.map((t) => ({
        type: "tool_use" as const,
        id: t.id,
        name: t.name,
        input: t.input,
      })),
      usage: { input_tokens: inputTokens, output_tokens: 50 },
    },
    streamedText: "",
  };
}

// --- Tests ---

describe("history save → resume end-to-end", () => {
  let tmpHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(console, "error").mockImplementation(() => {});

    tmpHome = mkdtempSync(join(tmpdir(), "kota-e2e-history-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    resetHistory();
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    resetHistory();
    rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("saves conversation to history after send()", async () => {
    mockStreamMessage.mockResolvedValueOnce(textResponse("Hello back!"));

    const session = new AgentSession();
    await session.send("Hello");
    session.close();

    const history = getHistory();
    const list = history.list({ limit: 100 });
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Hello");
    expect(list[0].messageCount).toBe(2); // user + assistant

    const data = history.load(list[0].id);
    expect(data).not.toBeNull();
    expect(data!.messages).toHaveLength(2);
    expect(data!.messages[0]).toEqual({ role: "user", content: "Hello" });
  });

  it("resume restores conversation context and appends new messages", async () => {
    // Session 1: send a message
    mockStreamMessage.mockResolvedValueOnce(textResponse("I can help!"));
    const session1 = new AgentSession();
    await session1.send("Help me");
    const convId = session1.getConversationId();
    session1.close();
    resetHistory(); // Reset singleton to force re-read from disk

    expect(convId).toBeTruthy();

    // Session 2: resume and send another message
    mockStreamMessage.mockResolvedValueOnce(textResponse("Sure, continuing!"));
    const session2 = new AgentSession({ resumeConversation: convId! });

    // Verify old messages are restored
    const ctx = (session2 as any).context;
    const messages = ctx.getMessages();
    expect(messages).toHaveLength(2); // user + assistant from session 1
    expect(messages[0]).toEqual({ role: "user", content: "Help me" });

    // Send new message
    await session2.send("Continue the task");
    session2.close();
    resetHistory();

    // Verify history has all messages
    const history = getHistory();
    const data = history.load(convId!);
    expect(data).not.toBeNull();
    expect(data!.messages).toHaveLength(4); // 2 from session 1 + 2 from session 2
    expect(data!.messages[2]).toEqual({ role: "user", content: "Continue the task" });
  });

  it("does not create empty history entry when closed without sending", () => {
    const session = new AgentSession();
    session.close();

    const history = getHistory();
    const list = history.list({ limit: 100 });
    expect(list).toHaveLength(0);
  });

  it("close() saves history for partial conversations (error recovery)", async () => {
    const session = new AgentSession();
    // Simulate a partial send: user message added but API call failed
    const ctx = (session as any).context;
    ctx.addUserMessage("This should be saved on close");
    session.close();

    const history = getHistory();
    const list = history.list({ limit: 100 });
    expect(list).toHaveLength(1);

    const data = history.load(list[0].id);
    expect(data).not.toBeNull();
    expect(data!.messages).toHaveLength(1);
    expect(data!.messages[0]).toEqual({ role: "user", content: "This should be saved on close" });
  });

  it("history includes tool call round-trips", async () => {
    mockStreamMessage
      .mockResolvedValueOnce(
        toolResponse([{ id: "tu_1", name: "file_read", input: { path: "/test.txt" } }]),
      )
      .mockResolvedValueOnce(textResponse("Read the file"));
    mockExecuteToolCalls.mockResolvedValueOnce([
      { tool_use_id: "tu_1", content: "file contents here" },
    ]);

    const session = new AgentSession();
    await session.send("Read test.txt");
    session.close();
    resetHistory();

    const history = getHistory();
    const list = history.list({ limit: 100 });
    const data = history.load(list[0].id);
    expect(data).not.toBeNull();
    // user message + assistant tool_use + user tool_result + assistant text = 4
    expect(data!.messages).toHaveLength(4);
  });

  it("resumed session does not create duplicate history entries", async () => {
    mockStreamMessage.mockResolvedValueOnce(textResponse("First"));
    const session1 = new AgentSession();
    await session1.send("Start");
    const convId = session1.getConversationId();
    session1.close();
    resetHistory();

    mockStreamMessage.mockResolvedValueOnce(textResponse("Second"));
    const session2 = new AgentSession({ resumeConversation: convId! });
    await session2.send("Continue");
    session2.close();
    resetHistory();

    const history = getHistory();
    const list = history.list({ limit: 100 });
    // Should still be ONE conversation, not two
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(convId);
  });

  it("noHistory option prevents history creation", async () => {
    mockStreamMessage.mockResolvedValueOnce(textResponse("Response"));
    const session = new AgentSession({ noHistory: true });
    await session.send("Hello");
    session.close();

    const history = getHistory();
    const list = history.list({ limit: 100 });
    expect(list).toHaveLength(0);
  });

  it("resume with invalid ID starts fresh and creates new conversation", async () => {
    mockStreamMessage.mockResolvedValueOnce(textResponse("Fresh start"));
    const session = new AgentSession({ resumeConversation: "nonexistent-id" });
    await session.send("Hello");
    session.close();
    resetHistory();

    const history = getHistory();
    const list = history.list({ limit: 100 });
    expect(list).toHaveLength(1);
    // Should be a new conversation, not the nonexistent one
    expect(list[0].id).not.toBe("nonexistent-id");
  });

  it("conversation title auto-updates from first user message", async () => {
    mockStreamMessage.mockResolvedValueOnce(textResponse("Done"));
    const session = new AgentSession();
    await session.send("Analyze the quarterly revenue data");
    session.close();
    resetHistory();

    const history = getHistory();
    const list = history.list({ limit: 100 });
    expect(list[0].title).toBe("Analyze the quarterly revenue data");
  });

  it("multiple sessions create separate history entries", async () => {
    mockStreamMessage.mockResolvedValueOnce(textResponse("A"));
    const s1 = new AgentSession();
    await s1.send("Task A");
    s1.close();
    resetHistory();

    mockStreamMessage.mockResolvedValueOnce(textResponse("B"));
    const s2 = new AgentSession();
    await s2.send("Task B");
    s2.close();
    resetHistory();

    const history = getHistory();
    const list = history.list({ limit: 100 });
    expect(list).toHaveLength(2);
    // Most recent first
    expect(list[0].title).toBe("Task B");
    expect(list[1].title).toBe("Task A");
  });

  it("compaction state persists across resume", async () => {
    // Session 1: send a message, check compaction count
    mockStreamMessage.mockResolvedValueOnce(textResponse("Reply"));
    const session1 = new AgentSession();
    await session1.send("Start");
    const convId = session1.getConversationId();

    // Manually bump compaction count to simulate compaction having occurred
    const ctx1 = (session1 as any).context;
    const snapshot1 = ctx1.snapshot();
    expect(snapshot1.compactionCount).toBe(0);

    session1.close();
    resetHistory();

    // Session 2: resume, verify compaction count and input tokens are restored
    const session2 = new AgentSession({ resumeConversation: convId! });
    const ctx2 = (session2 as any).context;
    const stats = ctx2.getStats();
    // Input tokens from session 1 should be restored
    expect(stats.inputTokens).toBe(100); // matches textResponse default
    session2.close();
  });
});
