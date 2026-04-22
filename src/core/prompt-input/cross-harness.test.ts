import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const messagesCreateMock = vi.fn();
const createModelClientMock = vi.fn();
const executeWithAgentSDKMock = vi.fn();

vi.mock("#core/model/model-client.js", () => ({
  createModelClient: (...args: unknown[]) => createModelClientMock(...args),
}));

vi.mock("#core/agent-sdk/index.js", async (importActual) => {
  const actual = await importActual<typeof import("#core/agent-sdk/index.js")>();
  return {
    ...actual,
    executeWithAgentSDK: (...args: unknown[]) => executeWithAgentSDKMock(...args),
  };
});

import { claudeAgentHarness } from "#modules/claude-agent-harness/adapter.js";
import { thinAgentHarness } from "#modules/thin-agent-harness/adapter.js";
import { expandUserPromptReferences } from "./expand.js";

const TEST_ROOT = join(process.cwd(), ".test-prompt-input-cross-harness");
const FIXTURE = join(TEST_ROOT, "fixture.md");

beforeAll(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
  writeFileSync(FIXTURE, "# Fixture\n\nHarness-neutral fixture body.\n", "utf-8");
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  messagesCreateMock.mockReset();
  createModelClientMock.mockReset();
  executeWithAgentSDKMock.mockReset();

  createModelClientMock.mockImplementation(({ model }: { model: string }) => ({
    client: { messages: { create: messagesCreateMock, stream: vi.fn() } },
    model,
    providerName: "anthropic",
  }));
  messagesCreateMock.mockResolvedValue({
    id: "msg_1",
    content: [{ type: "text", text: "ok" }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  executeWithAgentSDKMock.mockResolvedValue({
    text: "ok",
    streamedText: "ok",
    turns: 1,
    isError: false,
  });
});

/**
 * Regression guard for the harness-neutral prompt-input contract.
 *
 * The preprocessor runs once at the CLI boundary and every harness adapter
 * receives the already-expanded text. A regression that moved expansion inside
 * one adapter (or dropped it from a caller) would leave the other adapter
 * with a raw `@path` token, breaking parity.
 */
describe("expandUserPromptReferences harness parity", () => {
  it("delivers the same expanded prompt to thin and claude-agent-sdk harnesses", async () => {
    const raw = "compare @fixture.md with current plans";
    const expanded = expandUserPromptReferences(raw, TEST_ROOT).text;

    expect(expanded).toContain('<file path="fixture.md">');
    expect(expanded).toContain("Harness-neutral fixture body.");

    await thinAgentHarness.run({
      prompt: expanded,
      model: "claude-haiku-4-5-20251001",
      effort: "xhigh",
      systemPrompt: "system",
    });

    await claudeAgentHarness.run({
      prompt: expanded,
      model: "claude-sonnet-4-6",
      cwd: TEST_ROOT,
      effort: "xhigh",
    });

    const thinCall = messagesCreateMock.mock.calls[0]?.[0] as {
      messages: { role: string; content: string }[];
    };
    const thinPrompt = thinCall.messages[0]?.content;

    const [claudePrompt] = executeWithAgentSDKMock.mock.calls[0] as [string];

    expect(thinPrompt).toBe(expanded);
    expect(claudePrompt).toBe(expanded);
    expect(thinPrompt).toBe(claudePrompt);
  });

  it("leaves a raw @missing reference in place for both harnesses", async () => {
    const raw = "this references @nonexistent.md on purpose";
    const expanded = expandUserPromptReferences(raw, TEST_ROOT).text;

    expect(expanded).toBe(raw);

    await thinAgentHarness.run({
      prompt: expanded,
      model: "claude-haiku-4-5-20251001",
      effort: "xhigh",
      systemPrompt: "system",
    });

    await claudeAgentHarness.run({
      prompt: expanded,
      model: "claude-sonnet-4-6",
      cwd: TEST_ROOT,
      effort: "xhigh",
    });

    const thinCall = messagesCreateMock.mock.calls[0]?.[0] as {
      messages: { role: string; content: string }[];
    };
    const thinPrompt = thinCall.messages[0]?.content;
    const [claudePrompt] = executeWithAgentSDKMock.mock.calls[0] as [string];

    expect(thinPrompt).toBe(raw);
    expect(claudePrompt).toBe(raw);
  });
});
