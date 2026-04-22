/**
 * End-to-end integration test: exercises the harness protocol through the
 * thin adapter, demonstrating operator-facing harness selection by name
 * without any implicit fallback to claude-agent-sdk.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAgentHarnessRegistryForTest,
  hasAgentHarness,
  listAgentHarnessNames,
  resolveAgentHarness,
} from "#core/agent-harness/index.js";
import { registerModelClientFactory } from "#core/model/model-client.js";

import claudeHarnessModule, { claudeAgentHarness } from "../claude-agent-harness/index.js";
import thinHarnessModule, { THIN_AGENT_HARNESS_NAME, thinAgentHarness } from "./index.js";

const messagesCreateMock = vi.fn();
const messagesStreamMock = vi.fn();

describe("thin agent harness integration", () => {
  beforeEach(() => {
    messagesCreateMock.mockReset();
    messagesStreamMock.mockReset();
    registerModelClientFactory(({ model }) => ({
      client: {
        messages: {
          create: messagesCreateMock,
          stream: messagesStreamMock,
        },
      },
      model,
      providerName: "test",
    }));
    messagesCreateMock.mockResolvedValue({
      id: "msg_integration_1",
      content: [{ type: "text", text: "thin says hi" }],
      usage: { input_tokens: 5, output_tokens: 4 },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("registers thin and claude adapters with the core registry", () => {
    expect(claudeHarnessModule.name).toBe("claude-agent-harness");
    expect(thinHarnessModule.name).toBe("thin-agent-harness");
    expect(hasAgentHarness(THIN_AGENT_HARNESS_NAME)).toBe(true);
    expect(hasAgentHarness("claude-agent-sdk")).toBe(true);
    expect(listAgentHarnessNames()).toEqual(
      expect.arrayContaining(["claude-agent-sdk", "thin"]),
    );
    expect(resolveAgentHarness("thin")).toBe(thinAgentHarness);
    expect(resolveAgentHarness("claude-agent-sdk")).toBe(claudeAgentHarness);
  });

  it("runs a full thin-harness turn end-to-end when selected by name", async () => {
    const harness = resolveAgentHarness("thin");
    const writer = { write: vi.fn().mockReturnValue(true) };
    const result = await harness.run(
      {
        prompt: "please respond",
        model: "anthropic/claude-haiku-4-5-20251001",
        effort: "xhigh",
        systemPrompt: "be terse",
      },
      writer,
    );

    expect(messagesCreateMock).toHaveBeenCalledTimes(1);
    expect(writer.write).toHaveBeenCalledWith("thin says hi");
    expect(result).toMatchObject({
      text: "thin says hi",
      streamedText: "thin says hi",
      turns: 1,
      inputTokens: 5,
      outputTokens: 4,
      isError: false,
    });
  });

  it("does not silently fall back to claude-agent-sdk when resolver is called with a bad name", () => {
    expect(() => resolveAgentHarness("nonexistent-harness")).toThrow(
      /Unknown agent harness "nonexistent-harness".*registered: claude-agent-sdk, thin/,
    );
  });

  it("fails loudly if no harnesses are registered and nothing is configured", () => {
    clearAgentHarnessRegistryForTest();
    expect(hasAgentHarness("thin")).toBe(false);
    expect(hasAgentHarness("claude-agent-sdk")).toBe(false);
    expect(() => resolveAgentHarness("thin")).toThrow(
      /no harnesses are registered/,
    );
  });
});
