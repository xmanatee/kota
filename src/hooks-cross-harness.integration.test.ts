import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const messagesCreateMock = vi.fn();
const createModelClientMock = vi.fn();
const executeWithAgentSDKMock = vi.fn();

vi.mock("#core/model/model-client.js", () => ({
  createModelClient: (...args: unknown[]) => createModelClientMock(...args),
}));

vi.mock("#modules/claude-agent-harness/executor.js", async (importActual) => {
  const actual = await importActual<typeof import("#modules/claude-agent-harness/executor.js")>();
  return {
    ...actual,
    executeWithAgentSDK: (...args: unknown[]) => executeWithAgentSDKMock(...args),
  };
});

import {
  registerHarnessHook,
  resetHarnessHooks,
  runAgentHarness,
} from "#core/agent-harness/index.js";
import { claudeAgentHarness } from "#modules/claude-agent-harness/adapter.js";
import { thinAgentHarness } from "#modules/thin-agent-harness/adapter.js";

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
    id: "msg_hook_cross",
    content: [{ type: "text", text: "thin-out" }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  executeWithAgentSDKMock.mockResolvedValue({
    text: "claude-out",
    streamedText: "claude-out",
    turns: 1,
    isError: false,
  });
});

afterEach(() => {
  resetHarnessHooks();
});

/**
 * The same module-owned `preRun`/`postRun` hooks must fire at the same
 * points regardless of which adapter the operator selected. A regression
 * that wired hooks into only one adapter would break this parity —
 * module-owned capabilities like an observation trail or skill-contributed
 * context would depend on harness choice in ways operators could not see.
 */
describe("harness hook parity across adapters", () => {
  it("fires preRun and postRun hooks when running via thin", async () => {
    const preRun = vi.fn();
    const postRun = vi.fn();
    registerHarnessHook({
      kind: "preRun",
      owner: "observer",
      name: "before",
      handler: preRun,
    });
    registerHarnessHook({
      kind: "postRun",
      owner: "observer",
      name: "after",
      handler: postRun,
    });

    await runAgentHarness(thinAgentHarness, {
      prompt: "say hi",
      model: "claude-haiku-4-5-20251001",
      effort: "xhigh",
      systemPrompt: "be terse",
    });

    expect(preRun).toHaveBeenCalledTimes(1);
    expect(postRun).toHaveBeenCalledTimes(1);
    expect(preRun.mock.calls[0][0].harness.name).toBe("thin");
    expect(postRun.mock.calls[0][0].result.text).toBe("thin-out");
  });

  it("fires preRun and postRun hooks when running via claude-agent-sdk", async () => {
    const preRun = vi.fn();
    const postRun = vi.fn();
    registerHarnessHook({
      kind: "preRun",
      owner: "observer",
      name: "before",
      handler: preRun,
    });
    registerHarnessHook({
      kind: "postRun",
      owner: "observer",
      name: "after",
      handler: postRun,
    });

    await runAgentHarness(claudeAgentHarness, {
      prompt: "task body",
      model: "claude-sonnet-4-6",
      cwd: "/tmp/project",
      effort: "xhigh",
    });

    expect(preRun).toHaveBeenCalledTimes(1);
    expect(postRun).toHaveBeenCalledTimes(1);
    expect(preRun.mock.calls[0][0].harness.name).toBe("claude-agent-sdk");
    expect(postRun.mock.calls[0][0].result.text).toBe("claude-out");
  });

  it("delivers the same hook payload shape to both adapters", async () => {
    const seen: Array<{ harnessName: string; prompt: string; resultText: string }> = [];
    registerHarnessHook({
      kind: "postRun",
      owner: "observer",
      name: "capture",
      handler: ({ harness, options, result }) => {
        seen.push({
          harnessName: harness.name,
          prompt: options.prompt,
          resultText: result.text,
        });
      },
    });

    await runAgentHarness(thinAgentHarness, {
      prompt: "parity-prompt",
      model: "claude-haiku-4-5-20251001",
      effort: "xhigh",
      systemPrompt: "be terse",
    });
    await runAgentHarness(claudeAgentHarness, {
      prompt: "parity-prompt",
      model: "claude-sonnet-4-6",
      cwd: "/tmp/project",
      effort: "xhigh",
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]?.harnessName).toBe("thin");
    expect(seen[1]?.harnessName).toBe("claude-agent-sdk");
    expect(seen[0]?.prompt).toBe("parity-prompt");
    expect(seen[1]?.prompt).toBe("parity-prompt");
  });
});
