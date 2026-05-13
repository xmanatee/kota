/**
 * Integration test: prove the codex agent harness can be selected by name
 * through the harness registry exactly like claude-agent-sdk, openai-tools,
 * thin, vercel, and gemini, with no implicit fallback.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasAgentHarness,
  listAgentHarnessNames,
  resolveAgentHarness,
} from "#core/agent-harness/index.js";

const runMock = vi.fn();
const toolMock = vi.fn();

vi.mock("@openai/agents", () => ({
  Agent: function MockAgent(this: unknown, config: Record<string, unknown>) {
    Object.assign(this as Record<string, unknown>, config);
  },
  run: (...args: unknown[]) => runMock(...args),
  tool: (definition: Record<string, unknown>) => {
    toolMock(definition);
    return definition;
  },
}));

import claudeHarnessModule from "../claude-agent-harness/index.js";
import geminiHarnessModule from "../gemini-agent-harness/index.js";
import openaiToolsHarnessModule from "../openai-tools-agent-harness/index.js";
import thinHarnessModule from "../thin-agent-harness/index.js";
import vercelHarnessModule from "../vercel-agent-harness/index.js";
import codexHarnessModule, {
  CODEX_AGENT_HARNESS_NAME,
  codexAgentHarness,
} from "./index.js";

function makeRunResult(): unknown {
  const completedPromise: Promise<void> = Promise.resolve();
  return {
    [Symbol.asyncIterator]: async function* () {
      yield {
        type: "raw_model_stream_event",
        data: { type: "output_text_delta", delta: "ok" },
      };
    },
    completed: completedPromise,
    finalOutput: "ok",
    rawResponses: [{ id: "cint" }],
    lastResponseId: "cint",
    runContext: { usage: { inputTokens: 1, outputTokens: 1 } },
  };
}

describe("codex agent harness integration", () => {
  beforeEach(() => {
    runMock.mockReset();
    toolMock.mockReset();
    runMock.mockResolvedValue(makeRunResult());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("registers alongside the other shipped harnesses under its declared name", () => {
    expect(claudeHarnessModule.name).toBe("claude-agent-harness");
    expect(thinHarnessModule.name).toBe("thin-agent-harness");
    expect(openaiToolsHarnessModule.name).toBe("openai-tools-agent-harness");
    expect(geminiHarnessModule.name).toBe("gemini-agent-harness");
    expect(vercelHarnessModule.name).toBe("vercel-agent-harness");
    expect(codexHarnessModule.name).toBe("codex-agent-harness");
    expect(hasAgentHarness(CODEX_AGENT_HARNESS_NAME)).toBe(true);
    expect(listAgentHarnessNames()).toEqual(
      expect.arrayContaining([
        "claude-agent-sdk",
        "thin",
        "openai-tools",
        "gemini",
        "vercel",
        "codex",
      ]),
    );
    expect(resolveAgentHarness(CODEX_AGENT_HARNESS_NAME)).toBe(
      codexAgentHarness,
    );
  });

  it("runs end-to-end through the registry without falling back to a different harness", async () => {
    const harness = resolveAgentHarness(CODEX_AGENT_HARNESS_NAME);
    const writer = { write: vi.fn().mockReturnValue(true) };
    const result = await harness.run(
      {
        prompt: "say ok",
        model: "gpt-5.5",
        effort: "xhigh",
      },
      writer,
    );

    expect(runMock).toHaveBeenCalledTimes(1);
    expect(writer.write).toHaveBeenCalledWith("ok");
    expect(result).toMatchObject({
      text: "ok",
      streamedText: "ok",
      isError: false,
    });
  });
});
