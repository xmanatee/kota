import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentTokenBudgetLedger,
  TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
} from "#core/agent-harness/token-budget.js";
import { resetCleanupHooks } from "#core/loop/cleanup-hooks.js";
import { resetPreSendHooks } from "#core/loop/pre-send-hooks.js";
import { AgentSession } from "./loop.js";
import { BufferTransport } from "./transport.js";

const {
  mockStreamMessage,
  mockExecuteToolCalls,
  mockVerifyTracker,
} = vi.hoisted(() => ({
  mockStreamMessage: vi.fn(),
  mockExecuteToolCalls: vi.fn(),
  mockVerifyTracker: {
    getState: vi.fn(() => ""),
    recordEdit: vi.fn(),
    checkShellCommand: vi.fn(),
    tick: vi.fn(),
  },
}));

vi.mock("#core/model/model-client.js", () => ({
  createModelClient: vi.fn(() => ({
    client: { messages: { stream: vi.fn(), create: vi.fn() } },
    model: "claude-sonnet-4-6",
    providerName: "anthropic",
  })),
  registerModelClientFactory: vi.fn(),
}));
vi.mock("#core/model/streaming.js", () => ({ streamMessage: mockStreamMessage }));
vi.mock("#core/tools/tool-runner.js", async () => {
  const actual = await vi.importActual<typeof import("#core/tools/tool-runner.js")>(
    "#core/tools/tool-runner.js",
  );
  return { ...actual, executeToolCalls: mockExecuteToolCalls };
});
vi.mock("#core/tools/index.js", () => ({
  getAllTools: () => [],
  executeTool: vi.fn(),
  getTodoState: vi.fn(() => ""),
}));
vi.mock("./project-context.js", () => ({ loadProjectContext: vi.fn(() => "") }));
vi.mock("./instruction-files.js", () => ({ loadInstructionContext: vi.fn(() => "") }));
vi.mock("#root/init.js", () => ({ buildSessionWarmup: vi.fn(() => "") }));
vi.mock("#core/tools/delegate.js", () => ({
  setDelegateConfig: vi.fn(),
  delegateTool: {
    name: "delegate",
    description: "",
    input_schema: { type: "object", properties: {} },
  },
}));
vi.mock("#core/daemon/task-store.js", () => ({
  initTaskStore: vi.fn(),
  getTaskStore: vi.fn(() => ({
    add: vi.fn(),
    update: vi.fn(),
    list: vi.fn(() => []),
    active: vi.fn(() => []),
    get: vi.fn(),
    clear: vi.fn(),
    archiveCompleted: vi.fn(() => 0),
    getActiveSummary: vi.fn(() => null),
    isEmpty: vi.fn(() => true),
    count: vi.fn(() => 0),
  })),
}));
vi.mock("#core/mcp/manager.js", () => ({
  McpManager: class MockMcpManager {
    static loadConfig() { return null; }
  },
}));
vi.mock("#core/loop/verify-tracker.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#core/loop/verify-tracker.js")>();
  return {
    ...actual,
    VerifyTracker: class MockVerifyTracker {
      getState = mockVerifyTracker.getState;
      recordEdit = mockVerifyTracker.recordEdit;
      checkShellCommand = mockVerifyTracker.checkShellCommand;
      tick = mockVerifyTracker.tick;
    },
    detectVerifyCommands: vi.fn(() => []),
  };
});
vi.mock("#core/modules/project-discovery.js", () => ({
  discoverProjectModules: vi.fn(async () => []),
}));
vi.mock("#core/modules/module-discovery.js", () => ({
  discoverModules: vi.fn(async () => []),
}));

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

function textResponse(text: string, inputTokens = 100) {
  return {
    response: {
      content: [{ type: "text" as const, text }],
      usage: { input_tokens: inputTokens, output_tokens: 50 },
    },
    streamedText: text,
  };
}

describe("AgentSession token budget", () => {
  let session: AgentSession;

  beforeEach(() => {
    vi.clearAllMocks();
    resetCleanupHooks();
    resetPreSendHooks();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    session?.close();
    resetCleanupHooks();
    resetPreSendHooks();
    vi.restoreAllMocks();
  });

  it("debits the AgentTokenBudgetLedger and stops before the next turn", async () => {
    const tokenBudget = new AgentTokenBudgetLedger({ maxTotalTokens: 100 });
    const transport = new BufferTransport();
    session = new AgentSession({
      autonomyMode: "autonomous",
      tokenBudget,
      transport,
    });
    mockStreamMessage.mockResolvedValueOnce(
      toolResponse([{ id: "tu_1", name: "grep", input: { pattern: "x" } }], 80),
    );

    await expect(session.send("search")).rejects.toMatchObject({
      name: TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
    });

    expect(mockStreamMessage).toHaveBeenCalledTimes(1);
    expect(mockExecuteToolCalls).not.toHaveBeenCalled();
    expect(tokenBudget.snapshot()).toMatchObject({
      usage: { inputTokens: 80, outputTokens: 50, totalTokens: 130 },
      exhausted: true,
      exhaustedBy: { kind: "session-turn", turn: 1 },
    });
    expect(transport.events).toContainEqual(
      expect.objectContaining({
        type: "error",
        message: expect.stringContaining("Agent token budget exhausted"),
      }),
    );
  });

  it("fails a final no-tool response that exhausts the budget", async () => {
    const tokenBudget = new AgentTokenBudgetLedger({ maxTotalTokens: 100 });
    const transport = new BufferTransport();
    session = new AgentSession({
      autonomyMode: "autonomous",
      tokenBudget,
      transport,
      reflectionEnabled: false,
    });
    mockStreamMessage.mockResolvedValueOnce(textResponse("done", 80));

    await expect(session.send("answer")).rejects.toMatchObject({
      name: TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
    });

    expect(mockStreamMessage).toHaveBeenCalledTimes(1);
    expect(mockExecuteToolCalls).not.toHaveBeenCalled();
    expect(tokenBudget.snapshot()).toMatchObject({
      usage: { inputTokens: 80, outputTokens: 50, totalTokens: 130 },
      exhausted: true,
      exhaustedBy: { kind: "session-turn", turn: 1 },
    });
    expect(transport.events).toContainEqual(
      expect.objectContaining({
        type: "error",
        message: expect.stringContaining("after model usage was reported"),
      }),
    );
  });
});
