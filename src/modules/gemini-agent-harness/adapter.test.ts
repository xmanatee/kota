import "./adapter-test-support.js";
import { describe, expect, it, vi } from "vitest";
import {
  GEMINI_AGENT_HARNESS_NAME,
  geminiAgentHarness,
} from "./adapter.js";
import {
  captureLastCallArgs,
  generateContentStreamMock,
  makeStreamFromChunks,
} from "./adapter-test-support.js";

describe("geminiAgentHarness — registration", () => {
  it("registers under the gemini name and supports multi-turn", () => {
    expect(geminiAgentHarness.name).toBe(GEMINI_AGENT_HARNESS_NAME);
    expect(geminiAgentHarness.name).toBe("gemini");
    expect(geminiAgentHarness.supportsMultiTurn).toBe(true);
    expect(geminiAgentHarness.supportedHookKinds).toEqual(["preRun", "postRun"]);
    expect(geminiAgentHarness.askOwnerToolName).toBe("ask_owner");
    expect(geminiAgentHarness.emitsAgentMessageStream).toBe(false);
    expect(geminiAgentHarness.toolControl).toBe("kota");
    expect(geminiAgentHarness.unsupportedRunOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          option: "mcpServers",
          runOption: "mcpServers",
        }),
        expect.objectContaining({
          option: "thinkingEnabled/thinkingBudget",
          runOption: "thinking",
        }),
        expect.objectContaining({
          option: "onMessage",
          runOption: "onMessage",
        }),
      ]),
    );
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
      usage: {
        tokens: { state: "complete", inputTokens: 18, outputTokens: 7 },
        cost: { state: "unavailable", reason: "provider-does-not-report" },
      },
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
    expect(result.usage).toEqual({
      tokens: { state: "unknown" },
      cost: { state: "unavailable", reason: "provider-does-not-report" },
    });
  });
});
