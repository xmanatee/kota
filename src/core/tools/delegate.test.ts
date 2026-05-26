import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import type {
  KotaContentBlock,
  KotaMessageStream,
  KotaModelResponse,
} from "#core/agent-harness/message-protocol.js";
import type { AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import type { ModelClient } from "#core/model/model-client.js";
import { runDelegate, setDelegateConfig } from "./delegate.js";

class TestStream implements KotaMessageStream {
  constructor(private readonly response: KotaModelResponse) {}

  on(_event: "text" | "thinking", _cb: (delta: string) => void): this {
    return this;
  }

  async finalMessage(): Promise<KotaModelResponse> {
    return this.response;
  }
}

function modelResponse(content: KotaContentBlock[]): KotaModelResponse {
  return {
    id: "msg_delegate",
    role: "assistant",
    model: "test-model",
    content,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

describe("runDelegate model output-token limits", () => {
  afterEach(() => {
    clearAgentHarnessRegistryForTest();
    setDelegateConfig({ model: "gpt-5.5" });
  });

  it("uses the selected non-default tier model's output-token budget", async () => {
    const stream = vi.fn(() =>
      new TestStream(modelResponse([{ type: "text", text: "fast done" }])),
    );
    const client: ModelClient = {
      messages: {
        stream,
        create: vi.fn(async () => modelResponse([{ type: "text", text: "unused" }])),
      },
    };
    setDelegateConfig({
      model: "openai/gpt-5.5",
      modelTiers: {
        fast: "openai/gpt-5.4-mini",
        balanced: "openai/gpt-5.4",
        capable: "openai/gpt-5.5",
      },
      client,
    });

    const result = await runDelegate({
      task: "Research vector search options",
      mode: "explore",
    });

    expect(result.is_error).toBeUndefined();
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-5.4-mini",
        max_tokens: 4096,
      }),
    );
  });

  it("changes the requested output-token budget when routing selects a different model", async () => {
    const stream = vi
      .fn()
      .mockReturnValueOnce(
        new TestStream(modelResponse([{ type: "text", text: "fast done" }])),
      )
      .mockReturnValueOnce(
        new TestStream(modelResponse([{ type: "text", text: "capable done" }])),
      );
    const client: ModelClient = {
      messages: {
        stream,
        create: vi.fn(async () => modelResponse([{ type: "text", text: "unused" }])),
      },
    };
    setDelegateConfig({
      model: "openai/gpt-5.5",
      modelTiers: {
        fast: "openai/gpt-5.4-mini",
        balanced: "openai/gpt-5.4",
        capable: "openai/gpt-5.5",
      },
      client,
    });

    await runDelegate({ task: "Research vector search options", mode: "explore" });
    await runDelegate({ task: "Plan the migration phases", mode: "explore" });

    expect(stream.mock.calls[0][0]).toMatchObject({
      model: "openai/gpt-5.4-mini",
      max_tokens: 4096,
    });
    expect(stream.mock.calls[1][0]).toMatchObject({
      model: "openai/gpt-5.5",
      max_tokens: 16384,
    });
  });

  it("fails before request dispatch for an unknown tier override without an explicit limit", async () => {
    const stream = vi.fn();
    const client: ModelClient = {
      messages: {
        stream,
        create: vi.fn(async () => modelResponse([{ type: "text", text: "unused" }])),
      },
    };
    setDelegateConfig({
      model: "openai/gpt-5.5",
      modelTiers: {
        fast: "openai/operator-model",
        balanced: "openai/gpt-5.4",
        capable: "openai/gpt-5.5",
      },
      client,
    });

    await expect(
      runDelegate({ task: "Research vector search options", mode: "explore" }),
    ).rejects.toThrow(
      /No output-token limit configured for model "openai\/operator-model"/,
    );
    expect(stream).not.toHaveBeenCalled();
  });

  it("allows an unknown tier override when config supplies an explicit limit", async () => {
    const stream = vi.fn(() =>
      new TestStream(modelResponse([{ type: "text", text: "custom done" }])),
    );
    const client: ModelClient = {
      messages: {
        stream,
        create: vi.fn(async () => modelResponse([{ type: "text", text: "unused" }])),
      },
    };
    setDelegateConfig({
      model: "openai/gpt-5.5",
      modelTiers: {
        fast: "openai/operator-model",
        balanced: "openai/gpt-5.4",
        capable: "openai/gpt-5.5",
      },
      modelOutputTokenLimits: { "operator-model": 7777 },
      client,
    });

    await runDelegate({ task: "Research vector search options", mode: "explore" });

    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/operator-model",
        max_tokens: 7777,
      }),
    );
  });

  it("passes explicit output-token limits to the agent-harness backend", async () => {
    let receivedOptions: AgentHarnessRunOptions | undefined;
    registerAgentHarness({
      name: "openai-tools",
      description: "delegate test harness",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: vi.fn(async (options) => {
        receivedOptions = options;
        return {
          text: "delegated",
          streamedText: "delegated",
          turns: 1,
          isError: false,
        };
      }),
    });
    setDelegateConfig({
      model: "openai/gpt-5.5",
      modelTiers: {
        fast: "openai/operator-model",
        balanced: "openai/gpt-5.4",
        capable: "openai/gpt-5.5",
      },
      modelOutputTokenLimits: { "operator-model": 7777 },
      backend: "agent-sdk",
      harness: "openai-tools",
    });

    const result = await runDelegate({
      task: "Research vector search options",
      mode: "explore",
    });

    expect(result.is_error).toBeUndefined();
    expect(receivedOptions).toMatchObject({
      model: "openai/operator-model",
      modelOutputTokenLimits: { "operator-model": 7777 },
    });
  });
});
