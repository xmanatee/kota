import { describe, expect, it, vi } from "vitest";
import type {
  KotaContentBlock,
  KotaMessage,
  KotaMessageStream,
  KotaModelResponse,
  KotaToolResultBlock,
} from "#core/agent-harness/message-protocol.js";
import { AgentTokenBudgetLedger } from "#core/agent-harness/token-budget.js";
import type { McpManager } from "#core/mcp/manager.js";
import type { ModelClient } from "#core/model/model-client.js";
import { runDelegateTurns } from "./delegate-turn.js";

class TestStream implements KotaMessageStream {
  constructor(private readonly response: KotaModelResponse) {}

  on(_event: "text" | "thinking", _cb: (delta: string) => void): this {
    return this;
  }

  async finalMessage(): Promise<KotaModelResponse> {
    return this.response;
  }
}

function modelResponse(
  content: KotaContentBlock[],
  usage: KotaModelResponse["usage"] = { input_tokens: 0, output_tokens: 0 },
): KotaModelResponse {
  return {
    id: "msg_test",
    role: "assistant",
    model: "test-model",
    content,
    stop_reason: content.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn",
    usage,
  };
}

describe("runDelegateTurns", () => {
  it("preserves MCP structuredContent and metadata in delegated tool results", async () => {
    const responses = [
      modelResponse([
        {
          type: "tool_use",
          id: "toolu_1",
          name: "mcp__search__lookup",
          input: { query: "kota" },
        },
      ]),
      modelResponse([{ type: "text", text: "done" }]),
    ];

    const stream = vi.fn(() => new TestStream(responses.shift()!));
    const client: ModelClient = {
      messages: {
        stream,
        create: vi.fn(async () => modelResponse([{ type: "text", text: "unused" }])),
      },
    };
    const mcpMgr = {
      isMcpTool: vi.fn((name: string) => name === "mcp__search__lookup"),
      getToolResultContentProvenance: vi.fn(() => ({
        kind: "external-mcp" as const,
        serverName: "search",
        source: "tool" as const,
        name: "lookup",
      })),
      executeTool: vi.fn(async () => ({
        content: "visible text",
        blocks: [
          {
            type: "text" as const,
            text: "visible text",
            _meta: { blockCache: "b1" },
          },
        ],
        structuredContent: { answer: 42, nested: { ok: true } },
        _meta: { resultCache: "r1" },
      })),
    } as unknown as McpManager;
    const messages: KotaMessage[] = [];

    const result = await runDelegateTurns({
      client,
      messages,
      systemBlocks: [],
      tools: [
        {
          name: "mcp__search__lookup",
          description: "Lookup",
          input_schema: { type: "object", properties: {} },
        },
      ],
      runners: {},
      mcpMgr,
      isExecute: false,
      selectedModel: "test-model",
      modelOutputTokenLimits: { "test-model": 1234 },
      maxTurns: 2,
      mode: "research",
      transport: undefined,
      costTracker: undefined,
      modifiedFiles: new Set(),
      collectedImages: [],
      toolsUsed: new Set(),
      urlsFetched: new Set(),
      searchQueries: new Set(),
    });

    expect(result.naturalEnd).toBe(true);
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        max_tokens: 1234,
      }),
    );
    expect(messages).toHaveLength(3);
    expect(messages[1].role).toBe("user");

    const toolResults = messages[1].content as KotaToolResultBlock[];
    expect(toolResults).toEqual([
      {
        type: "tool_result",
        tool_use_id: "toolu_1",
        content: [
          {
            type: "text",
            text: "visible text",
            _meta: { blockCache: "b1" },
          },
        ],
        structuredContent: { answer: 42, nested: { ok: true } },
        _meta: { resultCache: "r1" },
      },
    ]);
  });

  it("stops before executing tool calls when the shared token budget is exhausted", async () => {
    const responses = [
      modelResponse(
        [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "write_tool",
            input: { path: "out.txt" },
          },
        ],
        { input_tokens: 8, output_tokens: 2 },
      ),
    ];

    const stream = vi.fn(() => new TestStream(responses.shift()!));
    const runner = vi.fn(async () => ({ content: "wrote" }));
    const client: ModelClient = {
      messages: {
        stream,
        create: vi.fn(async () => modelResponse([{ type: "text", text: "unused" }])),
      },
    };
    const tokenBudget = new AgentTokenBudgetLedger({ maxTotalTokens: 10 });
    const messages: KotaMessage[] = [];

    const result = await runDelegateTurns({
      client,
      messages,
      systemBlocks: [],
      tools: [
        {
          name: "write_tool",
          description: "Write",
          input_schema: { type: "object", properties: {} },
        },
      ],
      runners: { write_tool: runner },
      mcpMgr: undefined,
      isExecute: true,
      selectedModel: "test-model",
      modelOutputTokenLimits: { "test-model": 1234 },
      maxTurns: 3,
      mode: "execute",
      transport: undefined,
      costTracker: undefined,
      tokenBudget,
      modifiedFiles: new Set(),
      collectedImages: [],
      toolsUsed: new Set(),
      urlsFetched: new Set(),
      searchQueries: new Set(),
    });

    expect(result.earlyError?.content).toContain("token_budget_exhausted");
    expect(result.totalTurns).toBe(1);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(runner).not.toHaveBeenCalled();
    expect(messages).toHaveLength(1);
    expect(tokenBudget.snapshot().usage.totalTokens).toBe(10);
  });
});
