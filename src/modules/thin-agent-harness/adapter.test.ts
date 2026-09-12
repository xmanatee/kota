import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentHarness } from "#core/agent-harness/runner.js";

const messagesCreateMock = vi.fn();
const createModelClientMock = vi.fn();

vi.mock("#core/model/model-client.js", () => ({
  createModelClient: (...args: unknown[]) => createModelClientMock(...args),
}));

import { thinAgentHarness } from "./adapter.js";

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
      turns: 1,
      isError: false,
      usage: {
        tokens: { state: "complete", inputTokens: 12, outputTokens: 3 },
        cost: { state: "unavailable", reason: "provider-does-not-report" },
      },
    });
  });

  it("uses an explicit operator output-token limit for a custom model id", async () => {
    messagesCreateMock.mockResolvedValue({
      id: "msg_thin_custom",
      content: [
        { type: "text", text: "custom" },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await thinAgentHarness.run({
      prompt: "say hi",
      model: "operator-model",
      modelOutputTokenLimits: { "operator-model": 7777 },
      effort: "xhigh",
    });

    expect(messagesCreateMock).toHaveBeenCalledWith({
      model: "operator-model",
      max_tokens: 7777,
      messages: [{ role: "user", content: "say hi" }],
    });
  });

  it("reconstructs previous text for the non-streaming ModelClient with current instructions", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-thin-resume-"));
    try {
      messagesCreateMock.mockResolvedValue({
        id: "provider-response", content: [{ type: "text", text: "The design is blue." }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });
      const options = { scopeRoot: root, cwd: root, continuityKey: "interactive:thin", prompt: "choose a design", model: "claude-haiku-4-5-20251001", effort: "high" as const };
      const first = await runAgentHarness(thinAgentHarness, options);
      const second = await runAgentHarness(thinAgentHarness, { ...options, prompt: "continue", systemPrompt: "current instructions" });
      expect(second.sessionId).toBe(first.sessionId);
      expect(second.sessionId).not.toBe("provider-response");
      expect(messagesCreateMock.mock.calls[1][0]).toMatchObject({
        system: "current instructions",
        messages: expect.arrayContaining([{ role: "assistant", content: [{ type: "text", text: "The design is blue." }] }]),
      });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("fails before request dispatch for an unknown model without an explicit limit", async () => {
    await expect(
      thinAgentHarness.run({
        prompt: "say hi",
        model: "operator-model",
        effort: "xhigh",
      }),
    ).rejects.toThrow(
      /No output-token limit configured for model "operator-model"/,
    );
    expect(createModelClientMock).toHaveBeenCalledWith({ model: "operator-model" });
    expect(messagesCreateMock).not.toHaveBeenCalled();
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
