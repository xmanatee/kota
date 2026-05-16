/**
 * Unit tests for the `vercel` agent harness. The Vercel AI SDK's `streamText`
 * is mocked at the module boundary so the suite asserts on the adapter's
 * loop shape (tool wiring, guardrail enforcement, unsupported-option
 * rejections, reasoning-effort passthrough) without making network calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";

const streamTextMock = vi.fn();
const stepCountIsMock = vi.fn((n: number) => ({ __stepCountIs: n }));
const jsonSchemaMock = vi.fn((schema: unknown) => ({ __jsonSchema: schema }));
const dynamicToolMock = vi.fn((definition: unknown) => definition);
const createOpenAIMock = vi.fn();
const executeToolMock = vi.fn();
const getAllToolsMock = vi.fn<() => readonly KotaTool[]>();

vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => streamTextMock(...args),
  stepCountIs: (n: number) => stepCountIsMock(n),
  jsonSchema: (schema: unknown) => jsonSchemaMock(schema),
  dynamicTool: (definition: unknown) => dynamicToolMock(definition),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (...args: unknown[]) => createOpenAIMock(...args),
}));

vi.mock("#core/tools/index.js", () => ({
  executeTool: (...args: unknown[]) => executeToolMock(...args),
  getAllTools: () => getAllToolsMock(),
}));

import {
  VERCEL_AGENT_HARNESS_NAME,
  vercelAgentHarness,
} from "./adapter.js";

const TEST_TOOL: KotaTool = {
  name: "echo_tool",
  description: "Echo the provided text",
  input_schema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
};

type StreamTextArgs = {
  model: unknown;
  messages: unknown;
  system?: string;
  tools?: Record<string, unknown>;
  stopWhen: unknown;
  abortSignal: AbortSignal;
  providerOptions: Record<string, unknown>;
  onChunk: (event: { chunk: { type: string; text?: string } }) => void;
};

type StreamTextStub = {
  text: Promise<string>;
  totalUsage: Promise<{ inputTokens: number; outputTokens: number }>;
  steps: Promise<Array<{ response: { id: string } }>>;
  finishReason: Promise<string>;
};

function captureStreamTextArgs(): StreamTextArgs {
  expect(streamTextMock).toHaveBeenCalled();
  return streamTextMock.mock.calls[streamTextMock.mock.calls.length - 1][0] as StreamTextArgs;
}

beforeEach(() => {
  streamTextMock.mockReset();
  stepCountIsMock.mockReset();
  stepCountIsMock.mockImplementation((n: number) => ({ __stepCountIs: n }));
  jsonSchemaMock.mockReset();
  jsonSchemaMock.mockImplementation((schema: unknown) => ({ __jsonSchema: schema }));
  dynamicToolMock.mockReset();
  dynamicToolMock.mockImplementation((definition: unknown) => definition);
  createOpenAIMock.mockReset();
  createOpenAIMock.mockImplementation(() => (modelId: string) => ({
    __languageModel: true,
    modelId,
  }));
  executeToolMock.mockReset();
  getAllToolsMock.mockReset();
  getAllToolsMock.mockReturnValue([TEST_TOOL]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("vercelAgentHarness — registration", () => {
  it("registers under the vercel name and supports multi-turn", () => {
    expect(vercelAgentHarness.name).toBe(VERCEL_AGENT_HARNESS_NAME);
    expect(vercelAgentHarness.name).toBe("vercel");
    expect(vercelAgentHarness.supportsMultiTurn).toBe(true);
    expect(vercelAgentHarness.supportedHookKinds).toEqual(["preRun", "postRun"]);
    expect(vercelAgentHarness.askOwnerToolName).toBe("ask_owner");
    expect(vercelAgentHarness.emitsAgentMessageStream).toBe(false);
    expect(vercelAgentHarness.toolControl).toBe("kota");
  });
});

describe("vercelAgentHarness — happy path", () => {
  it("forwards prompt/system/tools/effort and returns the SDK's final text", async () => {
    const stub: StreamTextStub = {
      text: Promise.resolve("all done"),
      totalUsage: Promise.resolve({ inputTokens: 18, outputTokens: 7 }),
      steps: Promise.resolve([{ response: { id: "step-1" } } as never]),
      finishReason: Promise.resolve("stop"),
    };
    streamTextMock.mockImplementation((args: StreamTextArgs) => {
      args.onChunk({ chunk: { type: "text-delta", text: "all done" } });
      return stub as unknown as never;
    });

    const writer = { write: vi.fn().mockReturnValue(true) };
    const result = await vercelAgentHarness.run(
      {
        prompt: "please echo",
        model: "openai/gpt-4o-mini",
        effort: "xhigh",
        systemPrompt: "be brief",
      },
      writer,
    );

    const args = captureStreamTextArgs();
    expect(args.system).toBe("be brief");
    expect(args.messages).toEqual([{ role: "user", content: "please echo" }]);
    expect(Object.keys(args.tools ?? {})).toEqual(["echo_tool"]);
    expect(args.providerOptions).toEqual({ openai: { reasoningEffort: "high" } });
    expect(args.stopWhen).toEqual({ __stepCountIs: 25 });
    expect(args.abortSignal).toBeInstanceOf(AbortSignal);

    expect(writer.write).toHaveBeenCalledWith("all done");
    expect(result).toMatchObject({
      text: "all done",
      streamedText: "all done",
      sessionId: "step-1",
      turns: 1,
      inputTokens: 18,
      outputTokens: 7,
      isError: false,
    });
  });
});

type ToolExecuteFn = (
  input: Record<string, unknown>,
  ctx: { toolCallId: string },
) => Promise<{ isError: boolean; content: unknown }>;

describe("vercelAgentHarness — guardrails", () => {
  async function runAndCaptureToolExecute(opts: {
    canUseTool?: import("#core/agent-harness/index.js").AgentCanUseTool;
    allowedTools?: string[];
    disallowedTools?: string[];
  }): Promise<{
    toolExecute: ToolExecuteFn;
    streamArgs: StreamTextArgs;
  }> {
    const stub: StreamTextStub = {
      text: Promise.resolve("ok"),
      totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
      steps: Promise.resolve([{ response: { id: "s1" } } as never]),
      finishReason: Promise.resolve("stop"),
    };
    streamTextMock.mockImplementation(() => stub as unknown as never);

    await vercelAgentHarness.run({
      prompt: "go",
      model: "openai/gpt-4o-mini",
      effort: "xhigh",
      ...(opts.canUseTool ? { canUseTool: opts.canUseTool } : {}),
      ...(opts.allowedTools ? { allowedTools: opts.allowedTools } : {}),
      ...(opts.disallowedTools ? { disallowedTools: opts.disallowedTools } : {}),
    });

    const streamArgs = captureStreamTextArgs();
    const toolDefs = streamArgs.tools as Record<string, { execute: ToolExecuteFn }>;
    const toolExecute = toolDefs.echo_tool.execute;
    return { toolExecute, streamArgs };
  }

  it("denies through canUseTool by returning a tool result with isError", async () => {
    const canUseTool = vi.fn().mockResolvedValue({
      behavior: "deny",
      message: "echo_tool blocked by policy",
    });
    const { toolExecute } = await runAndCaptureToolExecute({ canUseTool });
    const result = await toolExecute(
      { text: "secret" },
      { toolCallId: "call_1" },
    );
    expect(canUseTool).toHaveBeenCalledWith(
      "echo_tool",
      { text: "secret" },
      expect.objectContaining({ signal: expect.any(AbortSignal), toolUseId: "call_1" }),
    );
    expect(executeToolMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      isError: true,
      content: "echo_tool blocked by policy",
    });
  });

  it("filters disallowedTools out of the Vercel ToolSet so the model never sees them", async () => {
    const stub: StreamTextStub = {
      text: Promise.resolve("ok"),
      totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
      steps: Promise.resolve([{ response: { id: "s1" } } as never]),
      finishReason: Promise.resolve("stop"),
    };
    streamTextMock.mockImplementation(() => stub as unknown as never);

    await vercelAgentHarness.run({
      prompt: "go",
      model: "openai/gpt-4o-mini",
      effort: "xhigh",
      disallowedTools: ["echo_tool"],
    });

    const args = captureStreamTextArgs();
    expect(args.tools).toBeUndefined();
  });

  it("only exposes allowedTools to the model (filtered at conversion time)", async () => {
    const otherTool: KotaTool = {
      name: "other_tool",
      description: "Other",
      input_schema: { type: "object", properties: {} },
    };
    getAllToolsMock.mockReturnValue([TEST_TOOL, otherTool]);

    const { streamArgs } = await runAndCaptureToolExecute({
      allowedTools: ["echo_tool"],
    });
    expect(Object.keys(streamArgs.tools ?? {})).toEqual(["echo_tool"]);
  });


  it("ends the loop with isError when canUseTool deny carries interrupt: true", async () => {
    const stub: StreamTextStub = {
      text: Promise.reject(new Error("aborted")),
      totalUsage: Promise.reject(new Error("aborted")),
      steps: Promise.reject(new Error("aborted")),
      finishReason: Promise.reject(new Error("aborted")),
    };
    // Silence the unhandled-rejection noise from rejected promises that the
    // adapter never awaits on the interrupt path. The adapter resolves via
    // its own interruptedResult helper before touching these.
    stub.text.catch(() => {});
    stub.totalUsage.catch(() => {});
    stub.steps.catch(() => {});
    stub.finishReason.catch(() => {});

    streamTextMock.mockImplementation((args: StreamTextArgs) => {
      const toolDefs = args.tools as Record<string, { execute: (input: Record<string, unknown>, ctx: { toolCallId: string }) => Promise<unknown> }>;
      // Invoke the tool's execute synchronously inside streamText so the
      // interrupt path runs before we resolve, mirroring what the SDK does.
      void toolDefs.echo_tool.execute({ text: "x" }, { toolCallId: "call_int" });
      return stub as unknown as never;
    });

    const canUseTool = vi.fn().mockResolvedValue({
      behavior: "deny",
      message: "commit_guard blocked git commit",
      interrupt: true,
    });

    // Allow the queued microtask to run before awaiting result.text.
    const promise = vercelAgentHarness.run({
      prompt: "go",
      model: "openai/gpt-4o-mini",
      effort: "xhigh",
      canUseTool,
    });

    // Wait microtask queue.
    await new Promise((r) => setImmediate(r));

    const result = await promise;
    expect(result.isError).toBe(true);
    expect(result.subtype).toBe("interrupted_by_can_use_tool");
    expect(result.text).toContain("commit_guard blocked git commit");
  });
});

describe("vercelAgentHarness — unsupported options rejection", () => {
  it("rejects mcpServers", async () => {
    await expect(
      vercelAgentHarness.run({
        prompt: "x",
        model: "openai/gpt-4o-mini",
        effort: "xhigh",
        mcpServers: { foo: { type: "stdio", command: "bar" } } as never,
      }),
    ).rejects.toThrow(/does not host MCP servers/);
  });

  it("rejects supervised autonomy mode", async () => {
    await expect(
      vercelAgentHarness.run({
        prompt: "x",
        model: "openai/gpt-4o-mini",
        effort: "xhigh",
        autonomyMode: "supervised",
      }),
    ).rejects.toThrow(/operator approval queue/);
  });

  it("rejects per-step harnessOverrides (no validateStepOptions)", async () => {
    await expect(
      vercelAgentHarness.run({
        prompt: "x",
        model: "openai/gpt-4o-mini",
        effort: "xhigh",
        harnessOverrides: { foo: "bar" },
      }),
    ).rejects.toThrow(/harnessOptions/);
  });

  it("rejects extended thinking", async () => {
    await expect(
      vercelAgentHarness.run({
        prompt: "x",
        model: "openai/gpt-4o-mini",
        effort: "xhigh",
        thinkingEnabled: true,
      }),
    ).rejects.toThrow(/extended thinking/);
  });

  it("rejects onMessage", async () => {
    await expect(
      vercelAgentHarness.run({
        prompt: "x",
        model: "openai/gpt-4o-mini",
        effort: "xhigh",
        onMessage: () => {},
      }),
    ).rejects.toThrow(/KotaAgentMessage/);
  });

  it("rejects persistSession", async () => {
    await expect(
      vercelAgentHarness.run({
        prompt: "x",
        model: "openai/gpt-4o-mini",
        effort: "xhigh",
        persistSession: true,
      }),
    ).rejects.toThrow(/persist sessions/);
  });

  it("rejects file checkpointing", async () => {
    await expect(
      vercelAgentHarness.run({
        prompt: "x",
        model: "openai/gpt-4o-mini",
        effort: "xhigh",
        enableFileCheckpointing: true,
      }),
    ).rejects.toThrow(/file checkpointing/);
  });

  it("refuses to run without an explicit model", async () => {
    await expect(
      vercelAgentHarness.run({ prompt: "x", effort: "xhigh" }),
    ).rejects.toThrow(/explicit model/);
  });
});

describe("vercelAgentHarness — provider routing", () => {
  it("rejects models without a provider prefix", async () => {
    await expect(
      vercelAgentHarness.run({
        prompt: "x",
        model: "gpt-4o-mini",
        effort: "xhigh",
      }),
    ).rejects.toThrow(/provider.*modelId/);
  });

  it("rejects models with an unregistered provider", async () => {
    await expect(
      vercelAgentHarness.run({
        prompt: "x",
        model: "unknown/some-model",
        effort: "xhigh",
      }),
    ).rejects.toThrow(/no provider "unknown"/);
  });
});

describe("vercelAgentHarness — reasoning-effort passthrough", () => {
  it("maps low/medium/high through to OpenAI reasoningEffort", async () => {
    const stub: StreamTextStub = {
      text: Promise.resolve("ok"),
      totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
      steps: Promise.resolve([{ response: { id: "s1" } } as never]),
      finishReason: Promise.resolve("stop"),
    };

    for (const [effort, mapped] of [
      ["low", "low"],
      ["medium", "medium"],
      ["high", "high"],
      ["xhigh", "high"],
      ["max", "high"],
    ] as const) {
      streamTextMock.mockReset();
      streamTextMock.mockImplementation(() => stub as unknown as never);
      await vercelAgentHarness.run({
        prompt: "x",
        model: "openai/gpt-4o-mini",
        effort,
      });
      const args = captureStreamTextArgs();
      expect(args.providerOptions).toEqual({
        openai: { reasoningEffort: mapped },
      });
    }
  });
});
