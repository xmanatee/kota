/**
 * Integration test: prove the gemini agent harness can be selected by name
 * through the harness registry exactly like claude-agent-sdk, openai-tools,
 * thin, and vercel, with no implicit fallback.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerAgentHarness,
  resolveAgentHarness,
} from "#core/agent-harness/index.js";

const generateContentStreamMock = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: function MockGoogleGenAI(this: unknown) {
    (this as { models: unknown }).models = {
      generateContentStream: (...args: unknown[]) =>
        generateContentStreamMock(...args),
    };
  },
}));

import {
  GEMINI_AGENT_HARNESS_NAME,
  geminiAgentHarness,
} from "./index.js";

function makeStream(chunks: ReadonlyArray<Record<string, unknown>>) {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

describe("gemini agent harness integration", () => {
  let disposeHarness: () => void;

  beforeEach(() => {
    disposeHarness = registerAgentHarness(geminiAgentHarness);
    generateContentStreamMock.mockReset();
    generateContentStreamMock.mockResolvedValue(
      makeStream([
        {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "ok" }] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
          responseId: "gint",
        },
      ]),
    );
  });

  afterEach(() => {
    disposeHarness();
    vi.clearAllMocks();
  });

  it("runs end-to-end through the registry without falling back to a different harness", async () => {
    const harness = resolveAgentHarness(GEMINI_AGENT_HARNESS_NAME);
    const writer = { write: vi.fn().mockReturnValue(true) };
    const result = await harness.run(
      {
        prompt: "say ok",
        model: "gemini-2.5-flash",
        effort: "xhigh",
      },
      writer,
    );

    expect(generateContentStreamMock).toHaveBeenCalledTimes(1);
    expect(writer.write).toHaveBeenCalledWith("ok");
    expect(result).toMatchObject({
      text: "ok",
      streamedText: "ok",
      isError: false,
    });
  });
});
