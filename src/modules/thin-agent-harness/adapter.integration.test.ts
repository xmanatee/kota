/**
 * End-to-end integration test: exercises the harness protocol through the
 * thin adapter, demonstrating operator-facing harness selection by name
 * without any implicit fallback to claude-agent-sdk.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerAgentHarness,
  resolveAgentHarness,
} from "#core/agent-harness/index.js";
import { registerModelClientFactory } from "#core/model/model-client.js";

import { thinAgentHarness } from "./index.js";

const messagesCreateMock = vi.fn();
const messagesStreamMock = vi.fn();

describe("thin agent harness integration", () => {
  let disposeHarness: () => void;

  beforeEach(() => {
    disposeHarness = registerAgentHarness(thinAgentHarness);
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
    disposeHarness();
    vi.clearAllMocks();
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
			usage: {
				tokens: { state: "complete", inputTokens: 5, outputTokens: 4 },
				cost: { state: "unavailable" },
			},
			isError: false,
    });
  });
});
