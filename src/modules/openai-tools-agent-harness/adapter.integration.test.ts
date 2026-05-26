/**
 * Integration test: prove the openai-tools harness can be selected by name
 * through the harness registry exactly like claude-agent-sdk and thin, with
 * no implicit fallback.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasAgentHarness,
  listAgentHarnessNames,
  resolveAgentHarness,
} from "#core/agent-harness/index.js";
import { registerModelClientFactory } from "#core/model/model-client.js";

import claudeHarnessModule from "../claude-agent-harness/index.js";
import thinHarnessModule from "../thin-agent-harness/index.js";
import openaiToolsHarnessModule, {
  OPENAI_TOOLS_AGENT_HARNESS_NAME,
  openaiToolsAgentHarness,
} from "./index.js";

const messagesStreamMock = vi.fn();
const messagesCreateMock = vi.fn();

describe("openai-tools agent harness integration", () => {
  beforeEach(() => {
    messagesStreamMock.mockReset();
    messagesCreateMock.mockReset();
    registerModelClientFactory(({ model }) => ({
      client: {
        messages: { create: messagesCreateMock, stream: messagesStreamMock },
      },
      model,
      providerName: "test",
    }));
    messagesStreamMock.mockReturnValue({
      on(event: string, cb: (delta: string) => void) {
        if (event === "text") cb("ok");
        return this;
      },
      finalMessage: async () => ({
        id: "msg_int",
        role: "assistant" as const,
        model: "test",
        content: [{ type: "text" as const, text: "ok" }],
        stop_reason: "end_turn" as const,
        stop_sequence: null,
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
        },
      }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("registers alongside claude-agent-sdk and thin under its declared name", () => {
    expect(claudeHarnessModule.name).toBe("claude-agent-harness");
    expect(thinHarnessModule.name).toBe("thin-agent-harness");
    expect(openaiToolsHarnessModule.name).toBe("openai-tools-agent-harness");
    expect(hasAgentHarness(OPENAI_TOOLS_AGENT_HARNESS_NAME)).toBe(true);
    expect(listAgentHarnessNames()).toEqual(
      expect.arrayContaining(["claude-agent-sdk", "thin", "openai-tools"]),
    );
    expect(resolveAgentHarness(OPENAI_TOOLS_AGENT_HARNESS_NAME)).toBe(
      openaiToolsAgentHarness,
    );
  });

  it("runs end-to-end through the registry without falling back to a different harness", async () => {
    const harness = resolveAgentHarness(OPENAI_TOOLS_AGENT_HARNESS_NAME);
    const writer = { write: vi.fn().mockReturnValue(true) };
    const result = await harness.run(
      {
        prompt: "say ok",
        model: "openai/gpt-5.4-mini",
        effort: "xhigh",
      },
      writer,
    );

    expect(messagesStreamMock).toHaveBeenCalledTimes(1);
    expect(writer.write).toHaveBeenCalledWith("ok");
    expect(result).toMatchObject({
      text: "ok",
      streamedText: "ok",
      turns: 1,
      isError: false,
    });
  });
});
