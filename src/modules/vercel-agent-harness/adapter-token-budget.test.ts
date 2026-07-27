import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentTokenBudgetLedger,
  runAgentHarness,
} from "#core/agent-harness/index.js";

const streamTextMock = vi.fn();
const stepCountIsMock = vi.fn((n: number) => ({ __stepCountIs: n }));
const jsonSchemaMock = vi.fn((schema: unknown) => ({ __jsonSchema: schema }));
const dynamicToolMock = vi.fn((definition: unknown) => definition);
const createOpenAIMock = vi.fn();
const getAllToolsMock = vi.fn();
const maskKnownSecretValuesMock = vi.fn<(text: string) => string>();

vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => streamTextMock(...args),
  stepCountIs: (n: number) => stepCountIsMock(n),
  jsonSchema: (schema: unknown) => jsonSchemaMock(schema),
  dynamicTool: (definition: unknown) => dynamicToolMock(definition),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (...args: unknown[]) => createOpenAIMock(...args),
}));

vi.mock("#core/tools/index.js", () => ({
  executeTool: vi.fn(),
  getAllTools: () => getAllToolsMock(),
  getToolEffect: () => undefined,
}));

vi.mock("#core/config/secrets.js", () => ({
  maskKnownSecretValues: (text: string) => maskKnownSecretValuesMock(text),
}));

import { vercelAgentHarness } from "./adapter.js";

beforeEach(() => {
  streamTextMock.mockReset();
  stepCountIsMock.mockReset();
  stepCountIsMock.mockImplementation((n: number) => ({ __stepCountIs: n }));
  jsonSchemaMock.mockReset();
  jsonSchemaMock.mockImplementation((schema: unknown) => ({ __jsonSchema: schema }));
  dynamicToolMock.mockReset();
  dynamicToolMock.mockImplementation((definition: unknown) => definition);
  createOpenAIMock.mockReset();
  createOpenAIMock.mockImplementation(() => (modelId: string) => ({
    __languageModel: true,
    modelId,
  }));
  getAllToolsMock.mockReset();
  maskKnownSecretValuesMock.mockReset();
  getAllToolsMock.mockReturnValue([]);
  maskKnownSecretValuesMock.mockImplementation((text) => text);
});

describe("vercelAgentHarness token budget", () => {
  it("records a missing-usage diagnostic instead of zero-token debit when SDK usage is absent", async () => {
    streamTextMock.mockImplementation(() => ({
      text: Promise.resolve("done"),
      totalUsage: Promise.resolve({}),
      steps: Promise.resolve([{ response: { id: "s1" } }]),
      finishReason: Promise.resolve("stop"),
    }));
    const tokenBudget = new AgentTokenBudgetLedger({ maxTotalTokens: 100 });

    const result = await runAgentHarness(vercelAgentHarness, {
      prompt: "go",
      model: "openai/gpt-4o-mini",
      effort: "xhigh",
      tokenBudget,
    });

    expect(result).toMatchObject({ isError: false, text: "done", turns: 1 });
    expect(result.inputTokens).toBeUndefined();
    expect(result.outputTokens).toBeUndefined();
    expect(tokenBudget.snapshot()).toMatchObject({
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      debits: [],
      diagnostics: [
        {
          kind: "missing-usage",
          source: {
            kind: "harness-result",
            harness: "vercel",
            model: "openai/gpt-4o-mini",
          },
        },
      ],
    });
  });
});
