import "./adapter-test-support.js";
import { describe, expect, it } from "vitest";
import { geminiAgentHarness } from "./adapter.js";
import {
  captureLastCallArgs,
  executeToolMock,
  generateContentStreamMock,
  makeStreamFromChunks,
} from "./adapter-test-support.js";

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
