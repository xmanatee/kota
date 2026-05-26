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
import { BufferTransport } from "#core/loop/transport.js";
import type { McpManager } from "#core/mcp/manager.js";
import type { MessageStreamParams, ModelClient } from "#core/model/model-client.js";
import { createDelegateBudget, runDelegate, setDelegateConfig } from "./delegate.js";

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

describe("runDelegate recursive budget", () => {
  afterEach(() => {
    setDelegateConfig({ model: "gpt-5.5" });
  });

  it("runs a normal delegate call under the default budget and reports budget status", async () => {
    const stream = vi.fn(() =>
      new TestStream(modelResponse([{ type: "text", text: "done" }])),
    );
    const client: ModelClient = {
      messages: {
        stream,
        create: vi.fn(async () => modelResponse([{ type: "text", text: "unused" }])),
      },
    };
    const transport = new BufferTransport();
    setDelegateConfig({
      model: "test-model",
      modelOutputTokenLimits: { "test-model": 1234 },
      client,
      transport,
    });

    const result = await runDelegate({ task: "Inspect the project", mode: "explore" });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("done");
    expect(stream).toHaveBeenCalledTimes(1);
    expect(
      transport.getStatusMessages().some((message) =>
        message.includes("[budget depth 1/2, active 1/4]"),
      ),
    ).toBe(true);
  });

  it("rejects a nested execute delegate at the recursive depth limit before model dispatch", async () => {
    const stream = vi.fn(() =>
      new TestStream(modelResponse([{ type: "text", text: "should not run" }])),
    );
    const client: ModelClient = {
      messages: {
        stream,
        create: vi.fn(async () => modelResponse([{ type: "text", text: "unused" }])),
      },
    };
    const budget = createDelegateBudget({ maxDepth: 1, maxActiveChildren: 4 });
    setDelegateConfig({
      model: "test-model",
      modelOutputTokenLimits: { "test-model": 1234 },
      client,
      delegateBudget: budget,
    });
    const parent = budget.tryStart();
    if (!parent.ok) throw new Error(parent.failure.message);

    try {
      const result = await parent.lease.run(() =>
        runDelegate({ task: "Start a child delegate", mode: "execute" }),
      );

      expect(result.is_error).toBe(true);
      expect(result.content).toContain("delegate budget exhausted");
      expect(result.content).toContain("maximum recursive depth 1 exceeded");
      expect(result._meta?.delegateBudget).toMatchObject({
        limit: "depth",
        depth: 1,
        requestedDepth: 2,
        maxDepth: 1,
      });
      expect(stream).not.toHaveBeenCalled();
    } finally {
      parent.lease.release();
    }
  });

  it("omits the delegate tool from sub-agent tools when the call is already at the depth limit", async () => {
    let streamedRequest: MessageStreamParams | undefined;
    const stream = vi.fn((request: MessageStreamParams) => {
      streamedRequest = request;
      return new TestStream(modelResponse([{ type: "text", text: "done at limit" }]));
    });
    const client: ModelClient = {
      messages: {
        stream,
        create: vi.fn(async () => modelResponse([{ type: "text", text: "unused" }])),
      },
    };
    const mcpManager = {
      getTools: () => [
        {
          name: "delegate",
          description: "Recursive delegate",
          input_schema: { type: "object" as const, properties: {} },
        },
      ],
      isMcpTool: vi.fn(() => false),
      executeTool: vi.fn(),
    } as unknown as McpManager;
    const budget = createDelegateBudget({ maxDepth: 1, maxActiveChildren: 4 });
    setDelegateConfig({
      model: "test-model",
      modelOutputTokenLimits: { "test-model": 1234 },
      client,
      mcpManager,
      delegateBudget: budget,
    });

    const result = await runDelegate({ task: "Execute at the depth limit", mode: "execute" });

    expect(result.is_error).toBeUndefined();
    expect(stream).toHaveBeenCalledTimes(1);
    expect(streamedRequest).toBeDefined();
    const toolNames = streamedRequest?.tools?.map((tool) => tool.name) ?? [];
    expect(toolNames).not.toContain("delegate");
  });

  it("rejects parallel child delegate calls beyond the active-child limit", async () => {
    const stream = vi.fn(() =>
      new TestStream(modelResponse([{ type: "text", text: "first child done" }])),
    );
    const client: ModelClient = {
      messages: {
        stream,
        create: vi.fn(async () => modelResponse([{ type: "text", text: "unused" }])),
      },
    };
    const budget = createDelegateBudget({ maxDepth: 2, maxActiveChildren: 2 });
    setDelegateConfig({
      model: "test-model",
      modelOutputTokenLimits: { "test-model": 1234 },
      client,
      delegateBudget: budget,
    });
    const parent = budget.tryStart();
    if (!parent.ok) throw new Error(parent.failure.message);

    try {
      const [first, second] = await parent.lease.run(() =>
        Promise.all([
          runDelegate({ task: "Start first child", mode: "execute" }),
          runDelegate({ task: "Start second child", mode: "execute" }),
        ]),
      );

      expect(first.is_error).toBeUndefined();
      expect(first.content).toContain("first child done");
      expect(second.is_error).toBe(true);
      expect(second.content).toContain("active child delegate limit 2 exceeded");
      expect(second._meta?.delegateBudget).toMatchObject({
        limit: "active_children",
        depth: 1,
        requestedDepth: 2,
        activeChildren: 2,
        maxActiveChildren: 2,
      });
      expect(stream).toHaveBeenCalledTimes(1);
    } finally {
      parent.lease.release();
    }
  });
});
