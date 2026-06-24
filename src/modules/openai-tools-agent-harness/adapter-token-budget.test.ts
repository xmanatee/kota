import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentTokenBudgetLedger,
  TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
} from "#core/agent-harness/index.js";
import type { KotaContentBlock, KotaModelResponse, KotaTool } from "#core/agent-harness/message-protocol.js";

const messagesStreamMock = vi.fn();
const createModelClientMock = vi.fn();
const executeToolMock = vi.fn();
const getAllToolsMock = vi.fn<() => readonly KotaTool[]>();
const getSecretStoreMock = vi.fn();

vi.mock("#core/model/model-client.js", () => ({
  createModelClient: (...args: unknown[]) => createModelClientMock(...args),
}));

vi.mock("#core/tools/index.js", () => ({
  executeTool: (...args: unknown[]) => executeToolMock(...args),
  getAllTools: () => getAllToolsMock(),
}));

vi.mock("#core/config/secrets.js", () => ({
  getSecretStore: () => getSecretStoreMock(),
}));

import { openaiToolsAgentHarness } from "./adapter.js";

type StubFinalMessage = Pick<KotaModelResponse, "id" | "content" | "stop_reason"> & {
  usage?: { input_tokens: number; output_tokens: number };
};

const TEST_TOOL: KotaTool = {
  name: "echo_tool",
  description: "Echo the provided text",
  input_schema: {
    type: "object" as const,
    properties: { text: { type: "string" } },
    required: ["text"],
  },
};

function makeStubStream(final: StubFinalMessage) {
  return {
    on() {
      return this;
    },
    finalMessage: async (): Promise<KotaModelResponse> => ({
      id: final.id,
      role: "assistant",
      model: "stub-model",
      content: final.content,
      stop_reason: final.stop_reason ?? "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: final.usage?.input_tokens ?? 0,
        output_tokens: final.usage?.output_tokens ?? 0,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
    }),
  };
}

beforeEach(() => {
  messagesStreamMock.mockReset();
  createModelClientMock.mockReset();
  executeToolMock.mockReset();
  getAllToolsMock.mockReset();
  getSecretStoreMock.mockReset();
  getAllToolsMock.mockReturnValue([TEST_TOOL]);
  getSecretStoreMock.mockReturnValue(null);
  createModelClientMock.mockReturnValue({
    model: "openai/gpt-5.4-mini",
    providerName: "openai",
    client: {
      messages: {
        stream: messagesStreamMock,
        create: vi.fn(),
      },
    },
  });
});

describe("openaiToolsAgentHarness token budget", () => {
  it("returns token_budget_exhausted when a final response exceeds the budget", async () => {
    messagesStreamMock.mockReturnValueOnce(
      makeStubStream({
        id: "msg_1",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "done" } as KotaContentBlock],
        usage: { input_tokens: 7, output_tokens: 4 },
      }),
    );
    const tokenBudget = new AgentTokenBudgetLedger({ maxTotalTokens: 10 });

    const result = await openaiToolsAgentHarness.run({
      prompt: "answer directly",
      model: "openai/gpt-5.4-mini",
      effort: "xhigh",
      tokenBudget,
    });

    expect(result).toMatchObject({
      isError: true,
      subtype: TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
      turns: 1,
      inputTokens: 7,
      outputTokens: 4,
    });
    expect(result.text).toContain("after model usage was reported");
    expect(executeToolMock).not.toHaveBeenCalled();
    expect(messagesStreamMock).toHaveBeenCalledTimes(1);
    expect(tokenBudget.snapshot().usage.totalTokens).toBe(11);
  });

  it("stops before dispatching tool calls when the token budget is exhausted", async () => {
    messagesStreamMock.mockReturnValueOnce(
      makeStubStream({
        id: "msg_1",
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "call_1",
            name: "echo_tool",
            input: { text: "hello" },
          } as KotaContentBlock,
        ],
        usage: { input_tokens: 6, output_tokens: 4 },
      }),
    );
    const tokenBudget = new AgentTokenBudgetLedger({ maxTotalTokens: 10 });

    const result = await openaiToolsAgentHarness.run({
      prompt: "please echo",
      model: "openai/gpt-5.4-mini",
      effort: "xhigh",
      tokenBudget,
    });

    expect(result).toMatchObject({
      isError: true,
      subtype: TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
      turns: 1,
      inputTokens: 6,
      outputTokens: 4,
    });
    expect(executeToolMock).not.toHaveBeenCalled();
    expect(messagesStreamMock).toHaveBeenCalledTimes(1);
    expect(tokenBudget.snapshot().usage.totalTokens).toBe(10);
  });

  it("passes active token budget, cwd, and workflow metadata to KOTA tool calls", async () => {
    messagesStreamMock
      .mockReturnValueOnce(
        makeStubStream({
          id: "msg_1",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "call_1",
              name: "echo_tool",
              input: { text: "hello" },
            } as KotaContentBlock,
          ],
          usage: { input_tokens: 2, output_tokens: 1 },
        }),
      )
      .mockReturnValueOnce(
        makeStubStream({
          id: "msg_2",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "done" } as KotaContentBlock],
          usage: { input_tokens: 3, output_tokens: 1 },
        }),
      );
    executeToolMock.mockResolvedValueOnce({ content: "echo: hello" });
    const tokenBudget = new AgentTokenBudgetLedger({ maxTotalTokens: 100 });
    const executionCwd = "/tmp/kota-openai-tools-metadata";
    const workflowContext = {
      workflowName: "builder",
      runId: "run-1",
      stepId: "build",
      spanId: "run-1:build",
      scopeId: "scope-1",
      projectId: "scope-1",
    };

    const result = await openaiToolsAgentHarness.run({
      prompt: "please echo",
      model: "openai/gpt-5.4-mini",
      effort: "xhigh",
      tokenBudget,
      cwd: executionCwd,
      workflowContext,
    });

    expect(result).toMatchObject({ isError: false, text: "done", turns: 2 });
    expect(executeToolMock).toHaveBeenCalledWith(
      "echo_tool",
      { text: "hello" },
      expect.objectContaining({
        toolUseId: "call_1",
        cwd: executionCwd,
        workflow: workflowContext,
        scopeId: "scope-1",
        projectId: "scope-1",
        tokenBudget,
      }),
    );
    expect(tokenBudget.snapshot().usage.totalTokens).toBe(7);
  });
});
