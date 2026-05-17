import { beforeEach, describe, expect, it, vi } from "vitest";

const messagesCreateMock = vi.fn();
const createModelClientMock = vi.fn();

vi.mock("#core/model/model-client.js", () => ({
  createModelClient: (...args: unknown[]) => createModelClientMock(...args),
}));

import { THIN_AGENT_HARNESS_NAME, thinAgentHarness } from "./adapter.js";

describe("thinAgentHarness", () => {
  beforeEach(() => {
    messagesCreateMock.mockReset();
    createModelClientMock.mockReset();
    createModelClientMock.mockImplementation(({ model }: { model: string }) => ({
      client: { messages: { create: messagesCreateMock, stream: vi.fn() } },
      model,
      providerName: "anthropic",
    }));
  });

  it("registers under the thin name", () => {
    expect(thinAgentHarness.name).toBe(THIN_AGENT_HARNESS_NAME);
    expect(thinAgentHarness.name).toBe("thin");
    expect(thinAgentHarness.unsupportedRunOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          option: "allowedTools",
          runOption: "allowedTools",
        }),
        expect.objectContaining({
          option: "disallowedTools",
          runOption: "disallowedTools",
        }),
        expect.objectContaining({
          option: "canUseTool",
          runOption: "canUseTool",
        }),
        expect.objectContaining({
          option: "onMessage",
          runOption: "onMessage",
        }),
      ]),
    );
  });

  it("runs a single-turn completion through the configured ModelClient", async () => {
    messagesCreateMock.mockResolvedValue({
      id: "msg_thin_1",
      content: [
        { type: "text", text: "hello from thin" },
      ],
      usage: { input_tokens: 12, output_tokens: 3 },
    });

    const writer = { write: vi.fn().mockReturnValue(true) };
    const result = await thinAgentHarness.run(
      {
        prompt: "say hi",
        model: "claude-haiku-4-5-20251001",
        effort: "xhigh",
        systemPrompt: "be terse",
      },
      writer,
    );

    expect(createModelClientMock).toHaveBeenCalledWith({
      model: "claude-haiku-4-5-20251001",
    });
    expect(messagesCreateMock).toHaveBeenCalledWith({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: "be terse",
      messages: [{ role: "user", content: "say hi" }],
    });
    expect(writer.write).toHaveBeenCalledWith("hello from thin");
    expect(result).toMatchObject({
      text: "hello from thin",
      streamedText: "hello from thin",
      sessionId: "msg_thin_1",
      turns: 1,
      isError: false,
      inputTokens: 12,
      outputTokens: 3,
    });
  });

  it("rejects tool-loop options because the harness has no tool surface", async () => {
    await expect(
      thinAgentHarness.run({
        prompt: "x",
        model: "claude-haiku-4-5-20251001",
        effort: "xhigh",
        allowedTools: ["Bash"],
      }),
    ).rejects.toThrow(/text-only/);

    await expect(
      thinAgentHarness.run({
        prompt: "x",
        model: "claude-haiku-4-5-20251001",
        effort: "xhigh",
        canUseTool: async () => ({
          behavior: "deny" as const,
          message: "nope",
        }),
      }),
    ).rejects.toThrow(/canUseTool/);
  });

  it("refuses to run without an explicit model", async () => {
    await expect(
      thinAgentHarness.run({ prompt: "x", effort: "xhigh" }),
    ).rejects.toThrow(/explicit model/);
  });
});
