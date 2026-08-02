import "./adapter-test-support.js";
import { describe, expect, it, vi } from "vitest";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import { geminiAgentHarness } from "./adapter.js";
import {
  captureLastCallArgs,
  executeToolMock,
  type GenerateContentArgs,
  generateContentStreamMock,
  getAllToolsMock,
  makeStreamFromChunks,
  TEST_TOOL,
} from "./adapter-test-support.js";

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
