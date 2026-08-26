/**
 * Unit tests for the `vercel` agent harness. The Vercel AI SDK's `streamText`
 * is mocked at the module boundary so the suite asserts on the adapter's loop
 * shape without making network calls.
 */

import { describe, expect, it, vi } from "vitest";
import {
  captureStreamTextArgs,
  createStreamTextStub,
  streamTextMock,
  VERCEL_AGENT_HARNESS_NAME,
  vercelAgentHarness,
} from "./adapter-test-support.js";

describe("vercelAgentHarness — registration", () => {
  it("registers under the vercel name and supports multi-turn", () => {
    expect(vercelAgentHarness.name).toBe(VERCEL_AGENT_HARNESS_NAME);
    expect(vercelAgentHarness.name).toBe("vercel");
    expect(vercelAgentHarness.supportsMultiTurn).toBe(true);
    expect(vercelAgentHarness.supportedHookKinds).toEqual(["preRun", "postRun"]);
    expect(vercelAgentHarness.askOwnerToolName).toBe("ask_owner");
    expect(vercelAgentHarness.emitsAgentMessageStream).toBe(false);
    expect(vercelAgentHarness.toolControl).toBe("kota");
    expect(vercelAgentHarness.unsupportedRunOptions).toEqual(
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

describe("vercelAgentHarness — happy path", () => {
  it("forwards prompt/system/tools/effort and returns the SDK's final text", async () => {
    streamTextMock.mockImplementation((args) => {
      args.onChunk({ chunk: { type: "text-delta", text: "all done" } });
      return createStreamTextStub({
        text: "all done",
        inputTokens: 18,
        outputTokens: 7,
        sessionId: "step-1",
      });
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
      usage: {
        tokens: { state: "complete", inputTokens: 18, outputTokens: 7 },
        cost: { state: "unavailable", reason: "provider-does-not-report" },
      },
      isError: false,
    });
  });
});
