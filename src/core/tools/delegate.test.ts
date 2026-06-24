import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import type { AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import type { MessageStreamParams } from "#core/model/model-client.js";
import { runDelegate, setDelegateConfig } from "./delegate.js";
import {
  modelClient,
  modelResponse,
  TestStream,
} from "./delegate-test-support.js";

const TIER_MODELS = {
  fast: "openai/gpt-5.4-mini",
  balanced: "openai/gpt-5.4",
  capable: "openai/gpt-5.5",
};

describe("runDelegate model output-token limits", () => {
  afterEach(() => {
    clearAgentHarnessRegistryForTest();
    setDelegateConfig({ model: "gpt-5.5" });
  });

  it("uses the selected non-default tier model's output-token budget", async () => {
    const stream = vi.fn(
      (_params: MessageStreamParams) =>
        new TestStream(modelResponse([{ type: "text", text: "fast done" }])),
    );
    setDelegateConfig({
      model: "openai/gpt-5.5",
      modelTiers: TIER_MODELS,
      client: modelClient(stream),
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
    setDelegateConfig({
      model: "openai/gpt-5.5",
      modelTiers: TIER_MODELS,
      client: modelClient(stream),
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
    const stream = vi.fn(
      (_params: MessageStreamParams) =>
        new TestStream(modelResponse([{ type: "text", text: "unused" }])),
    );
    setDelegateConfig({
      model: "openai/gpt-5.5",
      modelTiers: {
        ...TIER_MODELS,
        fast: "openai/operator-model",
      },
      client: modelClient(stream),
    });

    await expect(
      runDelegate({ task: "Research vector search options", mode: "explore" }),
    ).rejects.toThrow(
      /No output-token limit configured for model "openai\/operator-model"/,
    );
    expect(stream).not.toHaveBeenCalled();
  });

  it("allows an unknown tier override when config supplies an explicit limit", async () => {
    const stream = vi.fn(
      (_params: MessageStreamParams) =>
        new TestStream(modelResponse([{ type: "text", text: "custom done" }])),
    );
    setDelegateConfig({
      model: "openai/gpt-5.5",
      modelTiers: {
        ...TIER_MODELS,
        fast: "openai/operator-model",
      },
      modelOutputTokenLimits: { "operator-model": 7777 },
      client: modelClient(stream),
    });

    await runDelegate({ task: "Research vector search options", mode: "explore" });

    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/operator-model",
        max_tokens: 7777,
      }),
    );
  });

  it("passes explicit output-token limits and workflow metadata to the agent-harness backend", async () => {
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
        ...TIER_MODELS,
        fast: "openai/operator-model",
      },
      modelOutputTokenLimits: { "operator-model": 7777 },
      backend: "agent-sdk",
      harness: "openai-tools",
    });

    const workflowMetadata = {
      workflowName: "builder",
      runId: "run-observable",
      stepId: "build",
      spanId: "run-observable:build",
      scopeId: "scope-a",
      projectId: "scope-a",
    };

    const result = await runDelegate(
      {
        task: "Research vector search options",
        mode: "explore",
      },
      {
        workflow: workflowMetadata,
      },
    );

    expect(result.is_error).toBeUndefined();
    expect(receivedOptions).toMatchObject({
      model: "openai/operator-model",
      modelOutputTokenLimits: { "operator-model": 7777 },
      workflowContext: workflowMetadata,
    });
  });
});
