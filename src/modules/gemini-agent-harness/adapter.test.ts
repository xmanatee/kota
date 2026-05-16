/**
 * Unit tests for the `gemini` agent harness. The Google Gen AI SDK's
 * `models.generateContentStream` is mocked at the module boundary so the
 * suite asserts on the adapter's loop shape (tool wiring, guardrail
 * enforcement, unsupported-option rejections, reasoning-effort passthrough)
 * without making network calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";

const generateContentStreamMock = vi.fn();
const googleGenAICtorMock = vi.fn();
const executeToolMock = vi.fn();
const getAllToolsMock = vi.fn<() => readonly KotaTool[]>();

vi.mock("@google/genai", () => ({
  GoogleGenAI: function MockGoogleGenAI(this: unknown, ...args: unknown[]) {
    googleGenAICtorMock(...args);
    (this as { models: unknown }).models = {
      generateContentStream: (...callArgs: unknown[]) =>
        generateContentStreamMock(...callArgs),
    };
  },
}));

vi.mock("#core/tools/index.js", () => ({
  executeTool: (...args: unknown[]) => executeToolMock(...args),
  getAllTools: () => getAllToolsMock(),
}));

import {
  GEMINI_AGENT_HARNESS_NAME,
  geminiAgentHarness,
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

type GenerateContentArgs = {
  model: string;
  contents: unknown;
  config: Record<string, unknown>;
};

function makeStreamFromChunks(
  chunks: ReadonlyArray<Record<string, unknown>>,
): AsyncGenerator<Record<string, unknown>> {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

function captureLastCallArgs(): GenerateContentArgs {
  expect(generateContentStreamMock).toHaveBeenCalled();
  return generateContentStreamMock.mock.calls[
    generateContentStreamMock.mock.calls.length - 1
  ][0] as GenerateContentArgs;
}

beforeEach(() => {
  generateContentStreamMock.mockReset();
  googleGenAICtorMock.mockReset();
  executeToolMock.mockReset();
  getAllToolsMock.mockReset();
  getAllToolsMock.mockReturnValue([TEST_TOOL]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("geminiAgentHarness — registration", () => {
  it("registers under the gemini name and supports multi-turn", () => {
    expect(geminiAgentHarness.name).toBe(GEMINI_AGENT_HARNESS_NAME);
    expect(geminiAgentHarness.name).toBe("gemini");
    expect(geminiAgentHarness.supportsMultiTurn).toBe(true);
    expect(geminiAgentHarness.supportedHookKinds).toEqual(["preRun", "postRun"]);
    expect(geminiAgentHarness.askOwnerToolName).toBe("ask_owner");
    expect(geminiAgentHarness.emitsAgentMessageStream).toBe(false);
    expect(geminiAgentHarness.toolControl).toBe("kota");
  });
});

describe("geminiAgentHarness — happy path", () => {
  it("forwards prompt/system/tools/effort and returns the streamed text", async () => {
    generateContentStreamMock.mockResolvedValue(
      makeStreamFromChunks([
        {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "all done" }] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: { promptTokenCount: 18, candidatesTokenCount: 7 },
          responseId: "resp-1",
        },
      ]),
    );

    const writer = { write: vi.fn().mockReturnValue(true) };
    const result = await geminiAgentHarness.run(
      {
        prompt: "please echo",
        model: "gemini-2.5-flash",
        effort: "xhigh",
        systemPrompt: "be brief",
      },
      writer,
    );

    const args = captureLastCallArgs();
    expect(args.model).toBe("gemini-2.5-flash");
    expect(args.contents).toEqual([
      { role: "user", parts: [{ text: "please echo" }] },
    ]);
    expect(args.config.systemInstruction).toBe("be brief");
    const tools = args.config.tools as Array<{
      functionDeclarations: Array<{ name: string }>;
    }>;
    expect(tools).toHaveLength(1);
    expect(tools[0].functionDeclarations.map((d) => d.name)).toEqual([
      "echo_tool",
    ]);
    expect(args.config.thinkingConfig).toEqual({ thinkingLevel: "HIGH" });

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

  it("ignores assistant 'thought' parts in streamed text but keeps text parts", async () => {
    generateContentStreamMock.mockResolvedValue(
      makeStreamFromChunks([
        {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  { text: "internal reasoning", thought: true },
                  { text: "visible answer" },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      ]),
    );

    const writer = { write: vi.fn().mockReturnValue(true) };
    const result = await geminiAgentHarness.run(
      {
        prompt: "go",
        model: "gemini-2.5-flash",
        effort: "high",
      },
      writer,
    );

    expect(writer.write).toHaveBeenCalledTimes(1);
    expect(writer.write).toHaveBeenCalledWith("visible answer");
    expect(result.text).toBe("visible answer");
  });
});

describe("geminiAgentHarness — multi-turn tool loop", () => {
  it("executes a functionCall, feeds back functionResponse, then ends on STOP", async () => {
    generateContentStreamMock
      .mockResolvedValueOnce(
        makeStreamFromChunks([
          {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      functionCall: {
                        id: "call_1",
                        name: "echo_tool",
                        args: { text: "ping" },
                      },
                    },
                  ],
                },
              },
            ],
          },
        ]),
      )
      .mockResolvedValueOnce(
        makeStreamFromChunks([
          {
            candidates: [
              {
                content: { role: "model", parts: [{ text: "pong" }] },
                finishReason: "STOP",
              },
            ],
          },
        ]),
      );

    executeToolMock.mockResolvedValue({ content: "echoed: ping" });

    const result = await geminiAgentHarness.run({
      prompt: "use the tool then say pong",
      model: "gemini-2.5-flash",
      effort: "xhigh",
    });

    expect(executeToolMock).toHaveBeenCalledWith("echo_tool", { text: "ping" });
    expect(generateContentStreamMock).toHaveBeenCalledTimes(2);

    const secondCall = generateContentStreamMock.mock.calls[1][0] as GenerateContentArgs;
    const turns = secondCall.contents as Array<{
      role: string;
      parts: Array<Record<string, unknown>>;
    }>;
    expect(turns).toHaveLength(3);
    expect(turns[2].role).toBe("user");
    const responsePart = turns[2].parts[0] as {
      functionResponse: { id: string; name: string; response: Record<string, unknown> };
    };
    expect(responsePart.functionResponse.id).toBe("call_1");
    expect(responsePart.functionResponse.name).toBe("echo_tool");
    expect(responsePart.functionResponse.response).toEqual({
      output: "echoed: ping",
    });

    expect(result).toMatchObject({
      text: "pong",
      turns: 2,
      isError: false,
    });
  });
});

describe("geminiAgentHarness — guardrails", () => {
  it("denies a tool through canUseTool by feeding back an error functionResponse", async () => {
    generateContentStreamMock.mockResolvedValueOnce(
      makeStreamFromChunks([
        {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    functionCall: {
                      id: "call_d",
                      name: "echo_tool",
                      args: { text: "secret" },
                    },
                  },
                ],
              },
            },
          ],
        },
      ]),
    );
    generateContentStreamMock.mockResolvedValueOnce(
      makeStreamFromChunks([
        {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "ok then" }] },
              finishReason: "STOP",
            },
          ],
        },
      ]),
    );

    const canUseTool = vi.fn().mockResolvedValue({
      behavior: "deny",
      message: "echo_tool blocked by policy",
    });

    const result = await geminiAgentHarness.run({
      prompt: "go",
      model: "gemini-2.5-flash",
      effort: "xhigh",
      canUseTool,
    });

    expect(canUseTool).toHaveBeenCalledWith(
      "echo_tool",
      { text: "secret" },
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        toolUseId: "call_d",
      }),
    );
    expect(executeToolMock).not.toHaveBeenCalled();

    const secondCall = generateContentStreamMock.mock.calls[1][0] as GenerateContentArgs;
    const turns = secondCall.contents as Array<{
      parts: Array<Record<string, unknown>>;
    }>;
    const responsePart = turns[2].parts[0] as {
      functionResponse: { response: Record<string, unknown> };
    };
    expect(responsePart.functionResponse.response).toEqual({
      error: "echo_tool blocked by policy",
    });

    expect(result.isError).toBe(false);
    expect(result.text).toBe("ok then");
  });

  it("filters disallowedTools out of the function declarations the model sees", async () => {
    generateContentStreamMock.mockResolvedValue(
      makeStreamFromChunks([
        {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "ok" }] },
              finishReason: "STOP",
            },
          ],
        },
      ]),
    );

    await geminiAgentHarness.run({
      prompt: "go",
      model: "gemini-2.5-flash",
      effort: "xhigh",
      disallowedTools: ["echo_tool"],
    });

    const args = captureLastCallArgs();
    expect(args.config.tools).toBeUndefined();
  });

  it("only exposes allowedTools to the model", async () => {
    const otherTool: KotaTool = {
      name: "other_tool",
      description: "Other",
      input_schema: { type: "object", properties: {} },
    };
    getAllToolsMock.mockReturnValue([TEST_TOOL, otherTool]);

    generateContentStreamMock.mockResolvedValue(
      makeStreamFromChunks([
        {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "ok" }] },
              finishReason: "STOP",
            },
          ],
        },
      ]),
    );

    await geminiAgentHarness.run({
      prompt: "go",
      model: "gemini-2.5-flash",
      effort: "xhigh",
      allowedTools: ["echo_tool"],
    });

    const args = captureLastCallArgs();
    const tools = args.config.tools as Array<{
      functionDeclarations: Array<{ name: string }>;
    }>;
    expect(tools[0].functionDeclarations.map((d) => d.name)).toEqual([
      "echo_tool",
    ]);
  });

  it("ends the loop with isError when canUseTool deny carries interrupt: true", async () => {
    generateContentStreamMock.mockResolvedValueOnce(
      makeStreamFromChunks([
        {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    functionCall: {
                      id: "call_int",
                      name: "echo_tool",
                      args: { text: "x" },
                    },
                  },
                ],
              },
            },
          ],
        },
      ]),
    );

    const canUseTool = vi.fn().mockResolvedValue({
      behavior: "deny",
      message: "commit_guard blocked git commit",
      interrupt: true,
    });

    const result = await geminiAgentHarness.run({
      prompt: "go",
      model: "gemini-2.5-flash",
      effort: "xhigh",
      canUseTool,
    });

    expect(result.isError).toBe(true);
    expect(result.subtype).toBe("interrupted_by_can_use_tool");
    expect(result.text).toContain("commit_guard blocked git commit");
    expect(generateContentStreamMock).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed functionCall (missing name) loudly", async () => {
    generateContentStreamMock.mockResolvedValueOnce(
      makeStreamFromChunks([
        {
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ functionCall: { args: { text: "x" } } }],
              },
            },
          ],
        },
      ]),
    );

    await expect(
      geminiAgentHarness.run({
        prompt: "go",
        model: "gemini-2.5-flash",
        effort: "xhigh",
      }),
    ).rejects.toThrow(/missing tool name/);
  });
});

describe("geminiAgentHarness — unsupported options rejection", () => {
  it("rejects mcpServers", async () => {
    await expect(
      geminiAgentHarness.run({
        prompt: "x",
        model: "gemini-2.5-flash",
        effort: "xhigh",
        mcpServers: { foo: { type: "stdio", command: "bar" } } as never,
      }),
    ).rejects.toThrow(/does not host MCP servers/);
  });

  it("rejects supervised autonomy mode", async () => {
    await expect(
      geminiAgentHarness.run({
        prompt: "x",
        model: "gemini-2.5-flash",
        effort: "xhigh",
        autonomyMode: "supervised",
      }),
    ).rejects.toThrow(/operator approval queue/);
  });

  it("rejects per-step harnessOverrides", async () => {
    await expect(
      geminiAgentHarness.run({
        prompt: "x",
        model: "gemini-2.5-flash",
        effort: "xhigh",
        harnessOverrides: { foo: "bar" },
      }),
    ).rejects.toThrow(/harnessOptions/);
  });

  it("rejects extended thinking via the claude-style toggle", async () => {
    await expect(
      geminiAgentHarness.run({
        prompt: "x",
        model: "gemini-2.5-flash",
        effort: "xhigh",
        thinkingEnabled: true,
      }),
    ).rejects.toThrow(/thinkingEnabled/);
  });

  it("rejects onMessage", async () => {
    await expect(
      geminiAgentHarness.run({
        prompt: "x",
        model: "gemini-2.5-flash",
        effort: "xhigh",
        onMessage: () => {},
      }),
    ).rejects.toThrow(/KotaAgentMessage/);
  });

  it("rejects persistSession", async () => {
    await expect(
      geminiAgentHarness.run({
        prompt: "x",
        model: "gemini-2.5-flash",
        effort: "xhigh",
        persistSession: true,
      }),
    ).rejects.toThrow(/persist sessions/);
  });

  it("rejects file checkpointing", async () => {
    await expect(
      geminiAgentHarness.run({
        prompt: "x",
        model: "gemini-2.5-flash",
        effort: "xhigh",
        enableFileCheckpointing: true,
      }),
    ).rejects.toThrow(/file checkpointing/);
  });

  it("refuses to run without an explicit model", async () => {
    await expect(
      geminiAgentHarness.run({ prompt: "x", effort: "xhigh" }),
    ).rejects.toThrow(/explicit model/);
  });
});

describe("geminiAgentHarness — reasoning-effort passthrough", () => {
  it("maps low/medium/high/xhigh/max through to thinkingConfig.thinkingLevel", async () => {
    for (const [effort, mapped] of [
      ["low", "LOW"],
      ["medium", "MEDIUM"],
      ["high", "HIGH"],
      ["xhigh", "HIGH"],
      ["max", "HIGH"],
    ] as const) {
      generateContentStreamMock.mockReset();
      generateContentStreamMock.mockResolvedValue(
        makeStreamFromChunks([
          {
            candidates: [
              {
                content: { role: "model", parts: [{ text: "ok" }] },
                finishReason: "STOP",
              },
            ],
          },
        ]),
      );
      await geminiAgentHarness.run({
        prompt: "x",
        model: "gemini-2.5-flash",
        effort,
      });
      const args = captureLastCallArgs();
      expect(args.config.thinkingConfig).toEqual({ thinkingLevel: mapped });
    }
  });
});

describe("geminiAgentHarness — max turns cap", () => {
  it("returns max_turns_reached when the model never stops calling tools", async () => {
    generateContentStreamMock.mockImplementation(() =>
      Promise.resolve(
        makeStreamFromChunks([
          {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      functionCall: {
                        id: "loop_call",
                        name: "echo_tool",
                        args: { text: "again" },
                      },
                    },
                  ],
                },
              },
            ],
          },
        ]),
      ),
    );
    executeToolMock.mockResolvedValue({ content: "ok" });

    const result = await geminiAgentHarness.run({
      prompt: "loop forever",
      model: "gemini-2.5-flash",
      effort: "xhigh",
      maxTurns: 3,
    });

    expect(result.isError).toBe(true);
    expect(result.subtype).toBe("max_turns_reached");
    expect(result.turns).toBe(3);
    expect(generateContentStreamMock).toHaveBeenCalledTimes(3);
  });
});
