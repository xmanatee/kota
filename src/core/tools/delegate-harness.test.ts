import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CostTracker } from "#core/loop/cost.js";
import type { Transport } from "#core/loop/transport.js";

const mockExecuteWithAgentSDK = vi.fn();

vi.mock("#modules/claude-agent-harness/executor.js", async () => {
  const actual = await vi.importActual<typeof import("#modules/claude-agent-harness/executor.js")>(
    "#modules/claude-agent-harness/executor.js",
  );
  return {
    ...actual,
    executeWithAgentSDK: (...args: unknown[]) =>
      mockExecuteWithAgentSDK(...args),
  };
});

await import("#modules/claude-agent-harness/index.js");

const { runDelegateHarness } = await import("./delegate-harness.js");

function mockTransport(): Transport & {
  messages: Array<{ type: string; message?: string; content?: string }>;
} {
  const messages: Array<{ type: string; message?: string; content?: string }> =
    [];
  return {
    messages,
    emit(event: unknown) {
      messages.push(event as { type: string; message?: string; content?: string });
    },
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Transport & {
    messages: Array<{ type: string; message?: string; content?: string }>;
  };
}

describe("delegate-harness", () => {
  beforeEach(() => {
    mockExecuteWithAgentSDK.mockReset();
  });

  it("streams progress and returns formatted result", async () => {
    mockExecuteWithAgentSDK.mockImplementation(async (_task, _options, writer) => {
      writer?.write("Working...");
      return {
        text: "Fixed the bug",
        streamedText: "Working...",
        sessionId: "sess-12345678",
        turns: 3,
        totalCostUsd: 0.02,
        subtype: "success",
        isError: false,
      };
    });

    const transport = mockTransport();
    const result = await runDelegateHarness("fix auth bug", "execute", {
      transport,
      harness: "claude-agent-sdk",
    });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("Fixed the bug");
    expect(result.content).toContain("agent-sdk");
    expect(transport.messages.some((message) => message.content === "Working...")).toBe(true);
  });

  it("tracks cost through costTracker.addRawCost", async () => {
    mockExecuteWithAgentSDK.mockResolvedValue({
      text: "Done",
      streamedText: "",
      turns: 2,
      totalCostUsd: 0.15,
      subtype: "success",
      isError: false,
    });

    const addRawCost = vi.fn();
    const costTracker = { addRawCost } as unknown as CostTracker;
    await runDelegateHarness("task", "execute", {
      costTracker,
      harness: "claude-agent-sdk",
    });

    expect(addRawCost).toHaveBeenCalledWith(0.15);
  });

  it("passes explore-mode options to the shared executor", async () => {
    mockExecuteWithAgentSDK.mockResolvedValue({
      text: "Found it",
      streamedText: "",
      turns: 1,
      subtype: "success",
      isError: false,
    });

    await runDelegateHarness("find all API endpoints", "explore", {
      cwd: "/tmp/project",
      model: "claude-haiku-4-5-20251001",
      instructionContext: "## Project Instructions\nUse AGENTS.md",
      harness: "claude-agent-sdk",
    });

    const [, options] = mockExecuteWithAgentSDK.mock.calls[0];
    expect(options).toMatchObject({
      cwd: "/tmp/project",
      model: "claude-haiku-4-5-20251001",
      permissionMode: "bypassPermissions",
      effort: "xhigh",
    });
    expect(options.maxTurns).toBeUndefined();
    expect(options.allowedTools).toContain("Read");
    expect(options.allowedTools).toContain("Grep");
    expect(options.allowedTools).not.toContain("Edit");
    expect(options.allowedTools).not.toContain("Write");
    // The claude adapter wraps the harness-neutral string systemPrompt into
    // its native SDK envelope before handing it to executeWithAgentSDK. The
    // adapter's own tests cover the exact wire shape; here we only assert the
    // portable instruction text was threaded through.
    expect(options.systemPrompt.append).toContain("Use AGENTS.md");
  });

  it("passes execute-mode options to the shared executor", async () => {
    mockExecuteWithAgentSDK.mockResolvedValue({
      text: "Done",
      streamedText: "",
      turns: 2,
      subtype: "success",
      isError: false,
    });

    await runDelegateHarness("fix the type error", "execute", {
      cwd: "/tmp/project",
      harness: "claude-agent-sdk",
    });

    const [, options] = mockExecuteWithAgentSDK.mock.calls[0];
    expect(options.maxTurns).toBeUndefined();
    expect(options.effort).toBe("xhigh");
    expect(options.allowedTools).toContain("Edit");
    expect(options.allowedTools).toContain("Write");
    expect(options.allowedTools).toContain("Bash");
  });

  it("reports turn limits from executor subtypes", async () => {
    mockExecuteWithAgentSDK.mockResolvedValue({
      text: "Ran out of turns",
      streamedText: "",
      turns: 25,
      subtype: "error_max_turns",
      isError: true,
    });

    const result = await runDelegateHarness("huge refactor", "execute", {
      harness: "claude-agent-sdk",
    });
    expect(result.content).toContain("hit turn limit");
  });

  it("emits start and done status messages", async () => {
    mockExecuteWithAgentSDK.mockResolvedValue({
      text: "Done",
      streamedText: "",
      turns: 2,
      sessionId: "sess-abcdef12",
      subtype: "success",
      isError: false,
    });

    const transport = mockTransport();
    await runDelegateHarness("task", "explore", {
      transport,
      harness: "claude-agent-sdk",
    });

    const statusMessages = transport.messages.filter((message) => message.type === "status");
    expect(statusMessages.length).toBeGreaterThanOrEqual(2);
    expect(statusMessages[0].message).toContain("starting");
    expect(statusMessages[0].message).toContain("agent-sdk");
    expect(statusMessages[statusMessages.length - 1].message).toContain("done");
  });

  it("fails loudly when no harness is supplied — no implicit default", async () => {
    // The agent-sdk backend must not silently re-pin subagents to
    // claude-agent-sdk when the caller omits `harness`. This proves the
    // behavior change: with `harness` undefined the call throws a loud,
    // operator-oriented error instead of quietly dispatching to claude.
    await expect(
      runDelegateHarness("task", "explore", {
        // @ts-expect-error — prove runtime rejection when the required field
        // is missing (the signature itself already forbids this).
        harness: undefined,
      }),
    ).rejects.toThrow(/requires a harness/);
    expect(mockExecuteWithAgentSDK).not.toHaveBeenCalled();
  });
});
