/**
 * Integration test: prove the gemini agent harness can be selected by name
 * through the harness registry exactly like claude-agent-sdk, openai-tools,
 * thin, and vercel, with no implicit fallback.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasAgentHarness,
  listAgentHarnessNames,
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

import claudeHarnessModule from "../claude-agent-harness/index.js";
import openaiToolsHarnessModule from "../openai-tools-agent-harness/index.js";
import thinHarnessModule from "../thin-agent-harness/index.js";
import geminiHarnessModule, {
  GEMINI_AGENT_HARNESS_NAME,
  geminiAgentHarness,
} from "./index.js";

function makeStream(chunks: ReadonlyArray<Record<string, unknown>>) {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

describe("gemini agent harness integration", () => {
  beforeEach(() => {
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
    vi.clearAllMocks();
  });

  it("registers alongside the other shipped harnesses under its declared name", () => {
    expect(claudeHarnessModule.name).toBe("claude-agent-harness");
    expect(thinHarnessModule.name).toBe("thin-agent-harness");
    expect(openaiToolsHarnessModule.name).toBe("openai-tools-agent-harness");
    expect(geminiHarnessModule.name).toBe("gemini-agent-harness");
    expect(hasAgentHarness(GEMINI_AGENT_HARNESS_NAME)).toBe(true);
    expect(listAgentHarnessNames()).toEqual(
      expect.arrayContaining([
        "claude-agent-sdk",
        "thin",
        "openai-tools",
        "gemini",
      ]),
    );
    expect(resolveAgentHarness(GEMINI_AGENT_HARNESS_NAME)).toBe(
      geminiAgentHarness,
    );
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
