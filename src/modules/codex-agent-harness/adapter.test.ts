/**
 * Unit tests for the `codex` agent harness. The OpenAI Agents SDK's
 * `Agent`/`run`/`tool` surfaces are mocked at the module boundary so the
 * suite asserts on the adapter's loop shape (tool wiring, guardrail
 * enforcement, unsupported-option rejections, reasoning-effort
 * passthrough) without making network calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";

type CapturedToolDefinition = {
  name: string;
  description: string;
  parameters: unknown;
  strict: boolean;
  execute: (
    input: Record<string, unknown>,
    runContext: unknown,
    details: { toolCall?: { callId?: string } } | undefined,
  ) => Promise<unknown>;
};

type CapturedAgent = {
  name: string;
  instructions: string;
  model: string;
  modelSettings: { reasoning: { effort: string } };
  tools: CapturedToolDefinition[];
};

type RunResultStub = {
  asyncEvents: ReadonlyArray<Record<string, unknown>>;
  finalOutput: string | undefined;
  rawResponses: Array<Record<string, unknown>>;
  lastResponseId: string | undefined;
  inputTokens: number;
  outputTokens: number;
  completedShouldThrow?: Error;
};

const agentCtorMock = vi.fn();
const runMock = vi.fn();
const toolMock = vi.fn();
const executeToolMock = vi.fn();
const getAllToolsMock = vi.fn<() => readonly KotaTool[]>();

vi.mock("@openai/agents", () => ({
  Agent: function MockAgent(this: unknown, config: CapturedAgent) {
    agentCtorMock(config);
    Object.assign(this as Record<string, unknown>, config);
  },
  run: (...args: unknown[]) => runMock(...args),
  tool: (definition: CapturedToolDefinition) => {
    toolMock(definition);
    return definition;
  },
}));

vi.mock("#core/tools/index.js", () => ({
  executeTool: (...args: unknown[]) => executeToolMock(...args),
  getAllTools: () => getAllToolsMock(),
}));

import {
  CODEX_AGENT_HARNESS_NAME,
  codexAgentHarness,
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

function makeRunResult(stub: RunResultStub): unknown {
  const completedPromise: Promise<void> = stub.completedShouldThrow
    ? Promise.reject(stub.completedShouldThrow)
    : Promise.resolve();
  // Avoid unhandled-rejection noise.
  completedPromise.catch(() => {});

  return {
    [Symbol.asyncIterator]: async function* () {
      for (const evt of stub.asyncEvents) yield evt;
    },
    completed: completedPromise,
    finalOutput: stub.finalOutput,
    rawResponses: stub.rawResponses,
    lastResponseId: stub.lastResponseId,
    runContext: {
      usage: {
        inputTokens: stub.inputTokens,
        outputTokens: stub.outputTokens,
      },
    },
  };
}

function captureLastAgentConfig(): CapturedAgent {
  expect(agentCtorMock).toHaveBeenCalled();
  return agentCtorMock.mock.calls[agentCtorMock.mock.calls.length - 1][0] as CapturedAgent;
}

function captureLastRunArgs(): {
  agent: CapturedAgent;
  prompt: string;
  options: { stream: boolean; maxTurns: number; signal: AbortSignal };
} {
  expect(runMock).toHaveBeenCalled();
  const call = runMock.mock.calls[runMock.mock.calls.length - 1];
  return {
    agent: call[0] as CapturedAgent,
    prompt: call[1] as string,
    options: call[2] as {
      stream: boolean;
      maxTurns: number;
      signal: AbortSignal;
    },
  };
}

beforeEach(() => {
  agentCtorMock.mockReset();
  runMock.mockReset();
  toolMock.mockReset();
  executeToolMock.mockReset();
  getAllToolsMock.mockReset();
  getAllToolsMock.mockReturnValue([TEST_TOOL]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("codexAgentHarness — registration", () => {
  it("registers under the codex name and supports multi-turn", () => {
    expect(codexAgentHarness.name).toBe(CODEX_AGENT_HARNESS_NAME);
    expect(codexAgentHarness.name).toBe("codex");
    expect(codexAgentHarness.supportsMultiTurn).toBe(true);
    expect(codexAgentHarness.supportedHookKinds).toEqual([
      "preRun",
      "postRun",
    ]);
    expect(codexAgentHarness.askOwnerToolName).toBe("ask_owner");
    expect(codexAgentHarness.emitsAgentMessageStream).toBe(false);
  });
});

describe("codexAgentHarness — happy path", () => {
  it("forwards prompt/system/tools/effort and returns the streamed text", async () => {
    runMock.mockResolvedValue(
      makeRunResult({
        asyncEvents: [
          {
            type: "raw_model_stream_event",
            data: { type: "output_text_delta", delta: "all done" },
          },
        ],
        finalOutput: "all done",
        rawResponses: [{ id: "resp-1" }],
        lastResponseId: "resp-1",
        inputTokens: 18,
        outputTokens: 7,
      }),
    );

    const writer = { write: vi.fn().mockReturnValue(true) };
    const result = await codexAgentHarness.run(
      {
        prompt: "please echo",
        model: "gpt-5.5",
        effort: "xhigh",
        systemPrompt: "be brief",
      },
      writer,
    );

    const config = captureLastAgentConfig();
    expect(config.name).toBe("kota-codex-agent");
    expect(config.instructions).toBe("be brief");
    expect(config.model).toBe("gpt-5.5");
    expect(config.modelSettings).toEqual({ reasoning: { effort: "xhigh" } });
    expect(config.tools.map((t) => t.name)).toEqual(["echo_tool"]);

    const runArgs = captureLastRunArgs();
    expect(runArgs.prompt).toBe("please echo");
    expect(runArgs.options.stream).toBe(true);
    expect(runArgs.options.maxTurns).toBe(25);
    expect(runArgs.options.signal).toBeInstanceOf(AbortSignal);

    expect(writer.write).toHaveBeenCalledWith("all done");
    expect(result).toMatchObject({
      text: "all done",
      streamedText: "all done",
      sessionId: "resp-1",
      turns: 1,
      inputTokens: 18,
      outputTokens: 7,
      isError: false,
    });
  });
});

type ToolExecuteFn = CapturedToolDefinition["execute"];

describe("codexAgentHarness — guardrails", () => {
  async function runAndCaptureToolExecute(opts: {
    canUseTool?: import("#core/agent-harness/index.js").AgentCanUseTool;
    allowedTools?: string[];
    disallowedTools?: string[];
  }): Promise<{
    toolExecute: ToolExecuteFn | undefined;
    config: CapturedAgent;
  }> {
    runMock.mockResolvedValue(
      makeRunResult({
        asyncEvents: [],
        finalOutput: "ok",
        rawResponses: [{ id: "r1" }],
        lastResponseId: "r1",
        inputTokens: 1,
        outputTokens: 1,
      }),
    );

    await codexAgentHarness.run({
      prompt: "go",
      model: "gpt-5.5",
      effort: "xhigh",
      ...(opts.canUseTool ? { canUseTool: opts.canUseTool } : {}),
      ...(opts.allowedTools ? { allowedTools: opts.allowedTools } : {}),
      ...(opts.disallowedTools ? { disallowedTools: opts.disallowedTools } : {}),
    });

    const config = captureLastAgentConfig();
    const toolExecute = config.tools.find((t) => t.name === "echo_tool")?.execute;
    return { toolExecute, config };
  }

  it("denies through canUseTool by returning the denial message as tool output", async () => {
    const canUseTool = vi.fn().mockResolvedValue({
      behavior: "deny",
      message: "echo_tool blocked by policy",
    });
    const { toolExecute } = await runAndCaptureToolExecute({ canUseTool });
    expect(toolExecute).toBeDefined();
    if (!toolExecute) throw new Error("missing tool execute");
    const result = await toolExecute({ text: "secret" }, undefined, {
      toolCall: { callId: "call_1" },
    });
    expect(canUseTool).toHaveBeenCalledWith(
      "echo_tool",
      { text: "secret" },
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        toolUseId: "call_1",
      }),
    );
    expect(executeToolMock).not.toHaveBeenCalled();
    expect(result).toBe("echo_tool blocked by policy");
  });

  it("filters disallowedTools out of the agent tool list so the model never sees them", async () => {
    runMock.mockResolvedValue(
      makeRunResult({
        asyncEvents: [],
        finalOutput: "ok",
        rawResponses: [{ id: "r1" }],
        lastResponseId: "r1",
        inputTokens: 1,
        outputTokens: 1,
      }),
    );

    await codexAgentHarness.run({
      prompt: "go",
      model: "gpt-5.5",
      effort: "xhigh",
      disallowedTools: ["echo_tool"],
    });

    const config = captureLastAgentConfig();
    expect(config.tools).toEqual([]);
  });

  it("only exposes allowedTools to the model (filtered at conversion time)", async () => {
    const otherTool: KotaTool = {
      name: "other_tool",
      description: "Other",
      input_schema: { type: "object", properties: {} },
    };
    getAllToolsMock.mockReturnValue([TEST_TOOL, otherTool]);

    const { config } = await runAndCaptureToolExecute({
      allowedTools: ["echo_tool"],
    });
    expect(config.tools.map((t) => t.name)).toEqual(["echo_tool"]);
  });

  it("ends the loop with isError when canUseTool deny carries interrupt: true", async () => {
    const interruptError = new Error("aborted by interrupt");
    runMock.mockImplementation(
      async (
        agent: CapturedAgent,
        _prompt: string,
        _opts: { signal: AbortSignal; stream: boolean; maxTurns: number },
      ) => {
        // Simulate the SDK calling the tool's execute synchronously inside its loop.
        const exec = agent.tools.find((t) => t.name === "echo_tool")?.execute;
        if (!exec) throw new Error("missing tool");
        await exec({ text: "x" }, undefined, {
          toolCall: { callId: "call_int" },
        });
        // After the interrupt fires through canUseTool, the SDK throws the
        // abort error. Mirror that with our stub.
        return makeRunResult({
          asyncEvents: [],
          finalOutput: undefined,
          rawResponses: [{ id: "r1" }],
          lastResponseId: "r1",
          inputTokens: 0,
          outputTokens: 0,
          completedShouldThrow: interruptError,
        });
      },
    );

    const canUseTool = vi.fn().mockResolvedValue({
      behavior: "deny",
      message: "commit_guard blocked git commit",
      interrupt: true,
    });

    const result = await codexAgentHarness.run({
      prompt: "go",
      model: "gpt-5.5",
      effort: "xhigh",
      canUseTool,
    });

    expect(result.isError).toBe(true);
    expect(result.subtype).toBe("interrupted_by_can_use_tool");
    expect(result.text).toContain("commit_guard blocked git commit");
  });

  it("rejects malformed tool input (non-object) loudly", async () => {
    const { toolExecute } = await runAndCaptureToolExecute({});
    expect(toolExecute).toBeDefined();
    if (!toolExecute) throw new Error("missing tool execute");
    await expect(
      toolExecute("not-an-object" as unknown as Record<string, unknown>, undefined, undefined),
    ).rejects.toThrow(/non-object input/);
  });
});

describe("codexAgentHarness — unsupported options rejection", () => {
  it("rejects mcpServers", async () => {
    await expect(
      codexAgentHarness.run({
        prompt: "x",
        model: "gpt-5.5",
        effort: "xhigh",
        mcpServers: { foo: { type: "stdio", command: "bar" } } as never,
      }),
    ).rejects.toThrow(/does not host MCP servers/);
  });

  it("rejects supervised autonomy mode", async () => {
    await expect(
      codexAgentHarness.run({
        prompt: "x",
        model: "gpt-5.5",
        effort: "xhigh",
        autonomyMode: "supervised",
      }),
    ).rejects.toThrow(/operator approval queue/);
  });

  it("rejects per-step harnessOverrides (no validateStepOptions)", async () => {
    await expect(
      codexAgentHarness.run({
        prompt: "x",
        model: "gpt-5.5",
        effort: "xhigh",
        harnessOverrides: { foo: "bar" },
      }),
    ).rejects.toThrow(/harnessOptions/);
  });

  it("rejects extended thinking", async () => {
    await expect(
      codexAgentHarness.run({
        prompt: "x",
        model: "gpt-5.5",
        effort: "xhigh",
        thinkingEnabled: true,
      }),
    ).rejects.toThrow(/thinkingEnabled/);
  });

  it("rejects onMessage", async () => {
    await expect(
      codexAgentHarness.run({
        prompt: "x",
        model: "gpt-5.5",
        effort: "xhigh",
        onMessage: () => {},
      }),
    ).rejects.toThrow(/KotaAgentMessage/);
  });

  it("rejects persistSession", async () => {
    await expect(
      codexAgentHarness.run({
        prompt: "x",
        model: "gpt-5.5",
        effort: "xhigh",
        persistSession: true,
      }),
    ).rejects.toThrow(/persist sessions/);
  });

  it("rejects file checkpointing", async () => {
    await expect(
      codexAgentHarness.run({
        prompt: "x",
        model: "gpt-5.5",
        effort: "xhigh",
        enableFileCheckpointing: true,
      }),
    ).rejects.toThrow(/file checkpointing/);
  });

  it("refuses to run without an explicit model", async () => {
    await expect(
      codexAgentHarness.run({ prompt: "x", effort: "xhigh" }),
    ).rejects.toThrow(/explicit model/);
  });
});

describe("codexAgentHarness — reasoning-effort passthrough", () => {
  it("maps low/medium/high/xhigh/max through to modelSettings.reasoning.effort", async () => {
    for (const [effort, mapped] of [
      ["low", "low"],
      ["medium", "medium"],
      ["high", "high"],
      ["xhigh", "xhigh"],
      ["max", "xhigh"],
    ] as const) {
      runMock.mockReset();
      agentCtorMock.mockReset();
      runMock.mockResolvedValue(
        makeRunResult({
          asyncEvents: [],
          finalOutput: "ok",
          rawResponses: [{ id: "r1" }],
          lastResponseId: "r1",
          inputTokens: 1,
          outputTokens: 1,
        }),
      );
      await codexAgentHarness.run({
        prompt: "x",
        model: "gpt-5.5",
        effort,
      });
      const config = captureLastAgentConfig();
      expect(config.modelSettings).toEqual({ reasoning: { effort: mapped } });
    }
  });
});

describe("codexAgentHarness — max turns cap", () => {
  it("returns max_turns_reached when the loop never produces a final output", async () => {
    runMock.mockResolvedValue(
      makeRunResult({
        asyncEvents: [],
        finalOutput: undefined,
        rawResponses: [{ id: "t1" }, { id: "t2" }, { id: "t3" }],
        lastResponseId: "t3",
        inputTokens: 5,
        outputTokens: 5,
      }),
    );

    const result = await codexAgentHarness.run({
      prompt: "loop",
      model: "gpt-5.5",
      effort: "xhigh",
      maxTurns: 3,
    });

    expect(result.isError).toBe(true);
    expect(result.subtype).toBe("max_turns_reached");
    expect(result.turns).toBe(3);
  });
});
