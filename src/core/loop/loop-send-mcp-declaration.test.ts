import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import { Context } from "./context.js";
import { CostTracker } from "./cost.js";
import type { AgentLoopState } from "./loop-init.js";
import { runSend } from "./loop-send.js";
import { resetPreSendHooks } from "./pre-send-hooks.js";
import { BufferTransport } from "./transport.js";

const { mockStreamMessage, mockExecuteToolCalls } = vi.hoisted(() => ({
  mockStreamMessage: vi.fn(),
  mockExecuteToolCalls: vi.fn(),
}));

vi.mock("#core/events/event-bus.js", () => ({ tryEmit: vi.fn() }));
vi.mock("#core/model/streaming.js", () => ({ streamMessage: mockStreamMessage }));
vi.mock("#core/tools/index.js", () => ({
  getAllTools: () => [],
  getTodoState: () => "",
}));
vi.mock("#core/tools/tool-runner.js", async () => {
  const actual = await vi.importActual<typeof import("#core/tools/tool-runner.js")>(
    "#core/tools/tool-runner.js",
  );
  return { ...actual, executeToolCalls: mockExecuteToolCalls };
});

function mcpTool(description: string): KotaTool {
  return {
    name: "mcp__remote__lookup",
    description,
    input_schema: { type: "object", properties: {} },
  };
}

function toolResponse(id: string) {
  return {
    response: {
      content: [{
        type: "tool_use" as const,
        id,
        name: "mcp__remote__lookup",
        input: {},
      }],
      usage: { input_tokens: 100, output_tokens: 10 },
    },
    streamedText: "",
  };
}

function textResponse(text: string) {
  return {
    response: {
      content: [{ type: "text" as const, text }],
      usage: { input_tokens: 100, output_tokens: 10 },
    },
    streamedText: text,
  };
}

function testLoopState(mcpManager: AgentLoopState["mcpManager"]): AgentLoopState {
  return {
    initialized: true,
    initPromise: Promise.resolve(),
    sessionStartTime: 0,
    sessionId: "session-test",
    sessionLabel: undefined,
    projectDir: process.cwd(),
    context: new Context("KOTA"),
    client: {} as never,
    model: "claude-sonnet-4-6",
    editorModel: "claude-sonnet-4-6",
    maxTokens: 8192,
    effectiveMaxTokens: 8192,
    thinkingConfig: undefined,
    verbose: false,
    transport: new BufferTransport(),
    defaultTransportProxy: undefined,
    showCost: false,
    verifyTracker: {
      getState: () => "",
      recordEdit: vi.fn(),
      checkShellCommand: vi.fn(),
      tick: vi.fn(),
    } as never,
    mcpManager,
    mcpInputResolver: undefined,
    mcpAuthorizationResolver: undefined,
    mcpServers: undefined,
    clientApprovalResolver: undefined,
    costTracker: new CostTracker(),
    reflectionEnabled: false,
    stateMachine: {
      canTransition: () => false,
      transition: vi.fn(),
    } as never,
    guardrailsConfig: {} as never,
    guardrailsSnapshot: {} as never,
    idempotencyStore: {} as never,
    sessionPath: undefined,
    historyEnabled: false,
    historySource: "user",
    conversationId: null,
    resumeConversationId: undefined,
    projectContext: "",
    instructionContext: "",
    modelTiers: undefined,
    modelOutputTokenLimits: undefined,
    channelIdentity: undefined,
    autonomyMode: "autonomous",
    moduleLoader: {} as never,
    closed: false,
    activeAbortControllers: new Set(),
    sigintHandler: () => {},
  };
}

describe("runSend MCP declaration refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPreSendHooks();
  });

  afterEach(() => {
    resetPreSendHooks();
  });

  it("refreshes MCP tools each model turn and passes the prompt-time fingerprint", async () => {
    let currentTool = mcpTool("[remote] version A");
    let currentFingerprint = "a".repeat(64);
    const manager = {
      getTools: vi.fn(() => [currentTool]),
      getToolDeclarationFingerprint: vi.fn(() => currentFingerprint),
    };
    mockStreamMessage
      .mockImplementationOnce(async ({ tools }: { tools: KotaTool[] }) => {
        expect(tools.filter((tool) => tool.name.startsWith("mcp__")).map((tool) => tool.description))
          .toEqual(["[remote] version A"]);
        return toolResponse("tool-a");
      })
      .mockImplementationOnce(async ({ tools }: { tools: KotaTool[] }) => {
        expect(tools.filter((tool) => tool.name.startsWith("mcp__")).map((tool) => tool.description))
          .toEqual(["[remote] version B"]);
        return toolResponse("tool-b");
      })
      .mockImplementationOnce(async ({ tools }: { tools: KotaTool[] }) => {
        expect(tools.filter((tool) => tool.name.startsWith("mcp__")).map((tool) => tool.description))
          .toEqual(["[remote] version B"]);
        return textResponse("done");
      });
    mockExecuteToolCalls
      .mockImplementationOnce(async (_blocks, options) => {
        expect(options.mcpPromptToolDeclarationFingerprints.get("mcp__remote__lookup"))
          .toBe("a".repeat(64));
        currentTool = mcpTool("[remote] version B");
        currentFingerprint = "b".repeat(64);
        return [{
          tool_use_id: "tool-a",
          content: "MCP declaration changed; retry",
          is_error: true,
        }];
      })
      .mockImplementationOnce(async (_blocks, options) => {
        expect(options.mcpPromptToolDeclarationFingerprints.get("mcp__remote__lookup"))
          .toBe("b".repeat(64));
        return [{ tool_use_id: "tool-b", content: "fresh call ok" }];
      });

    const result = await runSend(testLoopState(manager as never), "use remote lookup");

    expect(result).toBe("done");
    expect(manager.getTools).toHaveBeenCalledTimes(3);
    expect(mockExecuteToolCalls).toHaveBeenCalledTimes(2);
  });
});
