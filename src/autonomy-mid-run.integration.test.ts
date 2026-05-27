import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { resetCleanupHooks } from "#core/loop/cleanup-hooks.js";

// Hoisted mocks for the layers this test wants to observe directly.
const {
  mockStreamMessage,
  mockExecuteTool,
  mockGetToolEffect,
  mockAssess,
  mockEnqueue,
} = vi.hoisted(() => ({
  mockStreamMessage: vi.fn(),
  mockExecuteTool: vi.fn(),
  mockGetToolEffect: vi.fn(),
  mockAssess: vi.fn(),
  mockEnqueue: vi.fn(
    (..._args: Parameters<ApprovalQueue["enqueue"]>) => ({ id: "appr-1" }),
  ),
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

// Crucially, we do NOT mock `./core/tools/tool-runner.js` here — the whole
// point of this test is to drive real executeToolCalls through the session
// with a mid-run autonomy mode switch and verify the downstream effect
// (executed vs queued) changes accordingly.

vi.mock("./core/tools/index.js", () => ({
  getAllTools: () => [],
  executeTool: mockExecuteTool,
  getToolEffect: mockGetToolEffect,
  getTodoState: vi.fn(() => ""),
}));
vi.mock("./core/tools/guardrails.js", async () => {
  const actual = await vi.importActual<typeof import("./core/tools/guardrails.js")>(
    "./core/tools/guardrails.js",
  );
  return { ...actual, assess: mockAssess };
});
vi.mock("./core/daemon/approval-queue.js", () => ({
  getApprovalQueue: vi.fn(() => ({ enqueue: mockEnqueue })),
}));
vi.mock("./project-context.js", () => ({ loadProjectContext: vi.fn(() => "") }));
vi.mock("./instruction-files.js", () => ({ loadInstructionContext: vi.fn(() => "") }));
vi.mock("./init.js", () => ({ buildSessionWarmup: vi.fn(() => "") }));
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
vi.mock("./core/daemon/task-store.js", () => ({
  initTaskStore: vi.fn(),
  getTaskStore: vi.fn(() => ({
    add: vi.fn(), update: vi.fn(), list: vi.fn(() => []),
    active: vi.fn(() => []), get: vi.fn(), clear: vi.fn(),
    archiveCompleted: vi.fn(() => 0), getActiveSummary: vi.fn(() => null),
    isEmpty: vi.fn(() => true), count: vi.fn(() => 0),
  })),
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

import { AgentSession } from "./core/loop/loop.js";

function toolResponse(
  tools: Array<{ id: string; name: string; input: Record<string, unknown> }>,
) {
  return {
    response: {
      content: tools.map((t) => ({
        type: "tool_use" as const,
        id: t.id,
        name: t.name,
        input: t.input,
      })),
      usage: { input_tokens: 100, output_tokens: 50 },
    },
    streamedText: "",
  };
}

function textResponse(text: string) {
  return {
    response: {
      content: [{ type: "text" as const, text }],
      usage: { input_tokens: 100, output_tokens: 50 },
    },
    streamedText: text,
  };
}

describe("autonomy mode mid-run switch", () => {
  let session: AgentSession;

  beforeEach(() => {
    vi.clearAllMocks();
    resetCleanupHooks();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockAssess.mockReturnValue({
      tool: "shell",
      risk: "moderate",
      policy: "allow",
      reason: "writes a file",
    });
    mockGetToolEffect.mockImplementation((name: string) => {
      if (name === "file_read") {
        return {
          kind: "read",
          scope: "local-fs",
          idempotent: true,
          openWorld: false,
        };
      }
      if (name === "shell") {
        return {
          kind: "write",
          scope: "local-fs",
          idempotent: false,
          openWorld: false,
        };
      }
      return undefined;
    });
    mockExecuteTool.mockResolvedValue({ content: "ok" });
  });

  afterEach(() => {
    session?.close();
    resetCleanupHooks();
    vi.restoreAllMocks();
  });

  it("executes a non-safe tool while autonomous, then queues the next one after switching to supervised", async () => {
    session = new AgentSession({ autonomyMode: "autonomous" });

    // First send: autonomous — one shell tool_use, then final text.
    mockStreamMessage
      .mockResolvedValueOnce(
        toolResponse([{ id: "tu_1", name: "shell", input: { command: "touch a" } }]),
      )
      .mockResolvedValueOnce(textResponse("first done"));

    await session.send("run first");

    expect(mockExecuteTool).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).not.toHaveBeenCalled();

    // Mid-run switch to supervised.
    session.setAutonomyMode("supervised");
    expect(session.getAutonomyMode()).toBe("supervised");

    // Second send: supervised — one shell tool_use, then final text.
    mockStreamMessage
      .mockResolvedValueOnce(
        toolResponse([{ id: "tu_2", name: "shell", input: { command: "touch b" } }]),
      )
      .mockResolvedValueOnce(textResponse("second done"));

    await session.send("run second");

    // Supervised: the non-safe call is queued, not executed.
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockExecuteTool).toHaveBeenCalledTimes(1);

    const [enqueuedTool, , enqueuedRisk] = mockEnqueue.mock.calls[0];
    expect(enqueuedTool).toBe("shell");
    expect(enqueuedRisk).toBe("moderate");
  });

  it("keeps safe tool calls executing after switch to supervised", async () => {
    session = new AgentSession({ autonomyMode: "autonomous" });

    // Switch before any call so the session is supervised from the start of this run.
    session.setAutonomyMode("supervised");

    mockAssess.mockReturnValue({
      tool: "file_read",
      risk: "safe",
      policy: "allow",
      reason: "read-only",
    });

    mockStreamMessage
      .mockResolvedValueOnce(
        toolResponse([{ id: "tu_3", name: "file_read", input: { path: "/x" } }]),
      )
      .mockResolvedValueOnce(textResponse("done"));

    await session.send("read safely");

    expect(mockExecuteTool).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
