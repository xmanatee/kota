/**
 * Integration test: prove the vercel agent harness can be selected by name
 * through the harness registry exactly like claude-agent-sdk, openai-tools,
 * and thin, with no implicit fallback.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerAgentHarness,
  resolveAgentHarness,
} from "#core/agent-harness/index.js";

const streamTextMock = vi.fn();

vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => streamTextMock(...args),
  stepCountIs: (n: number) => ({ __stepCountIs: n }),
  jsonSchema: (schema: unknown) => ({ __jsonSchema: schema }),
  dynamicTool: (definition: unknown) => definition,
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => (modelId: string) => ({
    __languageModel: true,
    modelId,
  }),
}));

import {
  VERCEL_AGENT_HARNESS_NAME,
  vercelAgentHarness,
} from "./index.js";

describe("vercel agent harness integration", () => {
  let disposeHarness: () => void;

  beforeEach(() => {
    disposeHarness = registerAgentHarness(vercelAgentHarness);
    streamTextMock.mockReset();
    streamTextMock.mockImplementation(
      (args: {
        onChunk: (event: { chunk: { type: string; text?: string } }) => void;
      }) => {
        args.onChunk({ chunk: { type: "text-delta", text: "ok" } });
        return {
          text: Promise.resolve("ok"),
          totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
          steps: Promise.resolve([{ response: { id: "vint" } }]),
          finishReason: Promise.resolve("stop"),
        } as unknown;
      },
    );
  });

  afterEach(() => {
    disposeHarness();
    vi.clearAllMocks();
  });

  it("runs end-to-end through the registry without falling back to a different harness", async () => {
    const harness = resolveAgentHarness(VERCEL_AGENT_HARNESS_NAME);
    const writer = { write: vi.fn().mockReturnValue(true) };
    const result = await harness.run(
      {
        prompt: "say ok",
        model: "openai/gpt-4o-mini",
        effort: "xhigh",
      },
      writer,
    );

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    expect(writer.write).toHaveBeenCalledWith("ok");
    expect(result).toMatchObject({
      text: "ok",
      streamedText: "ok",
      isError: false,
    });
  });
});
