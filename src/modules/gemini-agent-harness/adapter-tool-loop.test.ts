import "./adapter-test-support.js";
import { describe, expect, it } from "vitest";
import { getGlobalConfigPath } from "#core/config/config.js";
import { geminiAgentHarness } from "./adapter.js";
import {
  executeToolMock,
  type GenerateContentArgs,
  generateContentStreamMock,
  makeStreamFromChunks,
  maskKnownSecretValuesMock,
} from "./adapter-test-support.js";

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

    expect(executeToolMock).toHaveBeenCalledWith(
      "echo_tool",
      { text: "ping" },
      {
        authorityConfigPath: getGlobalConfigPath(),
        toolUseId: "call_1",
      },
    );
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

  it("masks registered secrets before feeding functionResponse content into the next model turn", async () => {
    maskKnownSecretValuesMock.mockImplementation((text) =>
      text.replaceAll("agent-secret-token", "<secret:API_TOKEN>"),
    );
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
                        id: "call_mask",
                        name: "echo_tool",
                        args: { text: "show token" },
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
                content: { role: "model", parts: [{ text: "done" }] },
                finishReason: "STOP",
              },
            ],
          },
        ]),
      );

    executeToolMock.mockResolvedValue({ content: "token=agent-secret-token" });

    await geminiAgentHarness.run({
      prompt: "read token",
      model: "gemini-2.5-flash",
      effort: "xhigh",
    });

    const secondCall = generateContentStreamMock.mock.calls[1][0] as GenerateContentArgs;
    const followUpTurn = JSON.stringify(secondCall.contents);
    expect(followUpTurn).toContain("<secret:API_TOKEN>");
    expect(followUpTurn).not.toContain("agent-secret-token");
  });
});
