import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentTokenBudgetLedger,
  TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
} from "#core/agent-harness/index.js";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";

const generateContentStreamMock = vi.fn();
const executeToolMock = vi.fn();
const getAllToolsMock = vi.fn<() => readonly KotaTool[]>();
const getSecretStoreMock = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: function MockGoogleGenAI(this: { models: unknown }) {
    this.models = {
      generateContentStream: (...callArgs: unknown[]) =>
        generateContentStreamMock(...callArgs),
    };
  },
}));

vi.mock("#core/tools/index.js", () => ({
  executeTool: (...args: unknown[]) => executeToolMock(...args),
  getAllTools: () => getAllToolsMock(),
}));

vi.mock("#core/config/secrets.js", () => ({
  getSecretStore: () => getSecretStoreMock(),
}));

import { geminiAgentHarness } from "./adapter.js";

const TEST_TOOL: KotaTool = {
  name: "echo_tool",
  description: "Echo the provided text",
  input_schema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
};

function makeStreamFromChunks(
  chunks: ReadonlyArray<Record<string, unknown>>,
): AsyncGenerator<Record<string, unknown>> {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

beforeEach(() => {
  generateContentStreamMock.mockReset();
  executeToolMock.mockReset();
  getAllToolsMock.mockReset();
  getSecretStoreMock.mockReset();
  getAllToolsMock.mockReturnValue([TEST_TOOL]);
  getSecretStoreMock.mockReturnValue(null);
});

describe("geminiAgentHarness token budget", () => {
  it("returns token_budget_exhausted when a final response exceeds the budget", async () => {
    generateContentStreamMock.mockResolvedValueOnce(
      makeStreamFromChunks([
        {
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: "done" }],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 4 },
          responseId: "resp-1",
        },
      ]),
    );
    const tokenBudget = new AgentTokenBudgetLedger({ maxTotalTokens: 10 });

    const result = await geminiAgentHarness.run({
      prompt: "answer directly",
      model: "gemini-2.5-flash",
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
    expect(generateContentStreamMock).toHaveBeenCalledTimes(1);
    expect(tokenBudget.snapshot().usage.totalTokens).toBe(11);
  });

  it("stops before executing function calls when the token budget is exhausted", async () => {
    generateContentStreamMock.mockResolvedValueOnce(
      makeStreamFromChunks([
        {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    functionCall: {
                      id: "call_1",
                      name: "echo_tool",
                      args: { text: "ping" },
                    },
                  },
                ],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 },
          responseId: "resp-1",
        },
      ]),
    );
    const tokenBudget = new AgentTokenBudgetLedger({ maxTotalTokens: 10 });

    const result = await geminiAgentHarness.run({
      prompt: "use the tool",
      model: "gemini-2.5-flash",
      effort: "xhigh",
      tokenBudget,
    });

    expect(result).toMatchObject({
      isError: true,
      subtype: TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
      turns: 1,
      inputTokens: 7,
      outputTokens: 3,
    });
    expect(executeToolMock).not.toHaveBeenCalled();
    expect(generateContentStreamMock).toHaveBeenCalledTimes(1);
    expect(tokenBudget.snapshot().usage.totalTokens).toBe(10);
  });

  it("passes active token budget, cwd, and workflow metadata to KOTA function calls", async () => {
    generateContentStreamMock
      .mockResolvedValueOnce(
        makeStreamFromChunks([
          {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      functionCall: {
                        id: "call_1",
                        name: "echo_tool",
                        args: { text: "ping" },
                      },
                    },
                  ],
                },
              },
            ],
            usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 },
            responseId: "resp-1",
          },
        ]),
      )
      .mockResolvedValueOnce(
        makeStreamFromChunks([
          {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: "done" }],
                },
                finishReason: "STOP",
              },
            ],
            usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 },
            responseId: "resp-2",
          },
        ]),
      );
    executeToolMock.mockResolvedValueOnce({ content: "pong" });
    const tokenBudget = new AgentTokenBudgetLedger({ maxTotalTokens: 100 });
    const executionCwd = "/tmp/kota-gemini-metadata";
    const workflowContext = {
      workflowName: "builder",
      runId: "run-1",
      stepId: "build",
      spanId: "run-1:build",
      scopeId: "scope-1",
      projectId: "scope-1",
    };
    const sessionContext = {
      sessionId: "session-1",
      scopeId: "scope-1",
      projectId: "scope-1",
    };

    const result = await geminiAgentHarness.run({
      prompt: "use the tool",
      model: "gemini-2.5-flash",
      effort: "xhigh",
      tokenBudget,
      cwd: executionCwd,
      sessionContext,
      workflowContext,
    });

    expect(result).toMatchObject({ isError: false, text: "done", turns: 2 });
    expect(executeToolMock).toHaveBeenCalledWith(
      "echo_tool",
      { text: "ping" },
      expect.objectContaining({
        toolUseId: "call_1",
        sessionId: "session-1",
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
