import { describe, expect, it } from "vitest";
import {
  captureStreamTextArgs,
  createStreamTextStub,
  streamTextMock,
  vercelAgentHarness,
} from "./adapter-test-support.js";

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
    for (const [effort, mapped] of [
      ["low", "low"],
      ["medium", "medium"],
      ["high", "high"],
      ["xhigh", "high"],
      ["max", "high"],
    ] as const) {
      streamTextMock.mockReset();
      streamTextMock.mockImplementation(() => createStreamTextStub());
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
